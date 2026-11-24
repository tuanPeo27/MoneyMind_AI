"""Categorize, weekly insights and quick-entry mode. Run from the ai-service folder:
python -m unittest discover -s tests -v"""
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.gemini_service import GeminiChatService, GeminiUnavailableError  # noqa: E402
from app.model_router import ModelRouter  # noqa: E402
from app.schemas import CategorizeRequest, CategoryOption, ChatRequest, InsightRequest  # noqa: E402
from app.tools import lite_first  # noqa: E402
from test_model_fallback import FakeClock, _advance, answer, api_error, chunk, part  # noqa: E402

MODELS = ["gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]


def reply(data, tokens=11):
    text = data if isinstance(data, str) else json.dumps(data)
    return SimpleNamespace(text=text, usage_metadata=SimpleNamespace(total_token_count=tokens))


class FakeModels:
    def __init__(self, behaviour: dict) -> None:
        self.behaviour = behaviour
        self.calls: list[str] = []
        self.configs: list = []

    async def generate_content(self, model, contents, config):
        self.calls.append(model)
        self.configs.append(config)
        result = self.behaviour[model]
        if isinstance(result, BaseException):
            raise result
        return result

    async def generate_content_stream(self, model, contents, config):
        self.calls.append(model)
        self.configs.append(config)
        result = self.behaviour[model]
        if isinstance(result, BaseException):
            raise result

        async def gen():
            for item in result:
                yield item
        return gen()


def make_service(behaviour: dict):
    settings = Settings(_env_file=None, gemini_api_key="k" * 12, service_key="s" * 32,
                        gemini_model_respond=MODELS[0], gemini_fallback_models=",".join(MODELS[1:]))
    router = ModelRouter(list(MODELS), clock=FakeClock())
    service = GeminiChatService(settings, router)
    fake = FakeModels(behaviour)
    service._client = SimpleNamespace(aio=SimpleNamespace(models=fake))
    service._sleep = _advance(router)
    return service, fake


CATEGORIZE = CategorizeRequest(description="Grab đi làm", amount=45000, type="Expense",
                               categories=[CategoryOption(id="c1", name="Ăn uống"),
                                           CategoryOption(id="c2", name="Di chuyển")])

FACTS = InsightRequest(facts='{"week":"2025-01-06","totalExpense":1200000}', language="vi")


class CategorizeTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_lite_model_first_and_returns_known_id(self):
        service, fake = make_service({m: reply({"category_id": "c2", "confidence": 0.93, "reason": "Grab"})
                                      for m in MODELS})
        result = await service.categorize(CATEGORIZE)
        self.assertEqual(fake.calls, ["gemini-3.5-flash-lite"])
        self.assertEqual((result.category_id, result.confidence, result.model), ("c2", 0.93, "gemini-3.5-flash-lite"))
        self.assertEqual(result.token_usage, 11)
        self.assertEqual(fake.configs[0].response_mime_type, "application/json")

    async def test_unknown_id_becomes_none(self):
        for bad in ("none", "c9", ""):
            with self.subTest(bad=bad):
                service, _ = make_service({m: reply({"category_id": bad, "confidence": 0.9}) for m in MODELS})
                result = await service.categorize(CATEGORIZE)
                self.assertIsNone(result.category_id)
                self.assertEqual(result.confidence, 0)

    async def test_confidence_is_clamped(self):
        service, _ = make_service({m: reply({"category_id": "c1", "confidence": 7}) for m in MODELS})
        self.assertEqual((await service.categorize(CATEGORIZE)).confidence, 1.0)

    async def test_invalid_json_and_quota_fall_back(self):
        service, fake = make_service({"gemini-3.5-flash-lite": reply("not json"),
                                      "gemini-3.1-flash-lite": api_error(429),
                                      "gemini-2.5-flash": reply({"category_id": "c1", "confidence": 0.8})})
        result = await service.categorize(CATEGORIZE)
        self.assertEqual(fake.calls, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"])
        self.assertEqual(result.category_id, "c1")

    async def test_all_models_failing_raises_unavailable(self):
        service, _ = make_service({m: api_error(503) for m in MODELS})
        with self.assertRaises(GeminiUnavailableError):
            await service.categorize(CATEGORIZE)

    async def test_bad_key_is_not_retried(self):
        service, fake = make_service({m: api_error(401) for m in MODELS})
        with self.assertRaises(GeminiUnavailableError):
            await service.categorize(CATEGORIZE)
        self.assertEqual(len(fake.calls), 1)


class ShortCooldownTests(unittest.IsolatedAsyncioTestCase):
    async def test_waits_out_a_short_cooldown_instead_of_calling_into_a_429(self):
        service, fake = make_service({m: reply({"category_id": "c1", "confidence": 0.9}) for m in MODELS})
        slept: list[float] = []
        advance = service._sleep

        async def sleep(seconds):
            slept.append(seconds)
            await advance(seconds)
        service._sleep = sleep
        for model in MODELS:
            service._router.mark_failed(model, 6)
        result = await service.categorize(CATEGORIZE)
        self.assertEqual(slept, [6])
        self.assertEqual(result.category_id, "c1")
        self.assertEqual(len(fake.calls), 1)

    async def test_long_cooldown_is_not_waited_for(self):
        service, _ = make_service({m: reply({"category_id": "c1", "confidence": 0.9}) for m in MODELS})
        slept: list[float] = []

        async def sleep(seconds):
            slept.append(seconds)
        service._sleep = sleep
        for model in MODELS:
            service._router.mark_failed(model, 1800)
        await service.categorize(CATEGORIZE)
        self.assertEqual(slept, [])


class InsightTests(unittest.IsolatedAsyncioTestCase):
    async def test_parses_and_limits_items(self):
        data = {
            "summary": "Tuần này bạn chi 1.200.000đ.",
            "items": [{"title": f"t{i}", "content": "c", "severity": "warning"} for i in range(6)],
            "recommendations": [
                {"title": "Đặt ngân sách", "description": "d",
                 "action": {"name": "create_budget", "category": "Ăn uống", "amount": 2000000}},
                {"title": "r2", "description": "d"},
                {"title": "r3", "description": "d"},
            ],
        }
        service, fake = make_service({m: reply(data) for m in MODELS})
        result = await service.insights(FACTS)
        self.assertEqual(fake.calls, ["gemini-2.5-flash"], "insights use the main model first")
        self.assertEqual((len(result.items), len(result.recommendations)), (4, 2))
        self.assertEqual(result.recommendations[0].action.name, "create_budget")
        self.assertEqual(result.recommendations[0].action.amount, 2000000)
        self.assertIsNone(result.recommendations[1].action)
        self.assertEqual(result.model, "gemini-2.5-flash")
        self.assertIn("tiếng Việt", fake.configs[0].system_instruction)

    async def test_wrong_shape_raises_unavailable(self):
        service, _ = make_service({m: reply({"items": "x"}) for m in MODELS})
        with self.assertRaises(GeminiUnavailableError):
            await service.insights(FACTS)


class CaptureModeTests(unittest.IsolatedAsyncioTestCase):
    async def test_capture_uses_lite_model_and_only_capture_tools(self):
        stream = [chunk(part(call=("create_transaction", {"amount": 35000, "category": "Ăn uống"})),
                        part(call=("create_budget", {"amount": 1})), tokens=5)]
        service, fake = make_service({m: stream for m in MODELS})
        result = await service.chat(ChatRequest(message="cà phê 35k", mode="capture"))
        self.assertEqual(fake.calls, ["gemini-3.5-flash-lite"])
        self.assertEqual([a.name for a in result.actions], ["create_transaction"])
        names = {fn.name for tool in fake.configs[0].tools for fn in tool.function_declarations}
        self.assertEqual(names, {"create_transaction", "create_category", "create_account"})

    async def test_chat_mode_keeps_main_model(self):
        service, fake = make_service({m: answer() for m in MODELS})
        await service.chat(ChatRequest(message="hi"))
        self.assertEqual(fake.calls, ["gemini-2.5-flash"])

    def test_lite_first_keeps_relative_order(self):
        self.assertEqual(lite_first(["a", "b-lite", "c", "d-lite"]), ["b-lite", "d-lite", "a", "c"])


if __name__ == "__main__":
    unittest.main()

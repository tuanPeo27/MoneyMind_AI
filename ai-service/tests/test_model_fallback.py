"""Run from the ai-service folder:  python -m unittest discover -s tests -v"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google.genai import errors  # noqa: E402

from app.config import Settings  # noqa: E402
from app.gemini_service import GeminiChatService, GeminiUnavailableError  # noqa: E402
from app.intent_filter import IntentTagFilter  # noqa: E402
from app.model_router import ModelRouter, classify  # noqa: E402
from app.schemas import ChatRequest  # noqa: E402

MODELS = ["primary", "second", "third"]


def api_error(code: int, message: str = "x", retry: str | None = None) -> errors.APIError:
    details = [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry}] if retry else []
    body = {"error": {"code": code, "message": message, "status": "ERR", "details": details}}
    return (errors.ClientError if code < 500 else errors.ServerError)(code, body)


def part(text=None, call=None, thought=False):
    fc = SimpleNamespace(name=call[0], args=call[1]) if call else None
    return SimpleNamespace(text=text, thought=thought, function_call=fc)


def chunk(*parts, tokens=None):
    return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=list(parts)))],
                           usage_metadata=SimpleNamespace(total_token_count=tokens) if tokens else None)


def answer(text="ok"):
    return [chunk(part(text), tokens=7)]


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class FakeModels:
    """`behaviour[model]` is a list of chunks to stream, an exception to raise when the call starts,
    or a function of the request config returning either."""

    def __init__(self, behaviour: dict) -> None:
        self.behaviour = behaviour
        self.calls: list[str] = []
        self.configs: list = []

    async def generate_content_stream(self, model, contents, config):
        self.calls.append(model)
        self.configs.append(config)
        result = self.behaviour[model]
        if callable(result):
            result = result(config)
        if isinstance(result, BaseException):
            raise result

        async def gen():
            for item in result:
                if isinstance(item, BaseException):
                    raise item
                yield item
        return gen()


def make_service(behaviour: dict, clock: FakeClock | None = None, models=MODELS):
    settings = Settings(_env_file=None, gemini_api_key="k" * 12, service_key="s" * 32,
                        gemini_model_respond=models[0], gemini_fallback_models=",".join(models[1:]))
    router = ModelRouter(list(models), clock=clock or FakeClock())
    service = GeminiChatService(settings, router)
    fake = FakeModels(behaviour)
    service._client = SimpleNamespace(aio=SimpleNamespace(models=fake))
    return service, fake, router


REQUEST = ChatRequest(message="hi", history=[], financial_context="{}")


async def collect(service):
    return [event async for event in service.stream(REQUEST)]


class ModelFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_quota_error_moves_to_next_model_and_skips_it_afterwards(self):
        service, fake, router = make_service({"primary": api_error(429, retry="37s"), "second": answer(), "third": answer()})

        first = await service.chat(REQUEST)
        self.assertEqual(first.model, "second")
        self.assertEqual(fake.calls, ["primary", "second"])
        self.assertEqual(router.cooldown_left("primary"), 37)

        fake.calls.clear()
        self.assertEqual((await service.chat(REQUEST)).model, "second")
        self.assertEqual(fake.calls, ["second"], "a model in cooldown must not be called again")

    async def test_primary_is_used_again_after_cooldown(self):
        clock = FakeClock()
        service, fake, _ = make_service({"primary": api_error(429, retry="20s"), "second": answer(), "third": answer()}, clock)
        await service.chat(REQUEST)

        clock.now += 21
        fake.behaviour["primary"] = answer("back")
        reply = await service.chat(REQUEST)
        self.assertEqual((reply.model, reply.content), ("primary", "back"))

    async def test_missing_model_and_overload_fall_back(self):
        for code in (404, 503, 500):
            with self.subTest(code=code):
                service, fake, _ = make_service({"primary": api_error(code), "second": api_error(code), "third": answer()})
                self.assertEqual((await service.chat(REQUEST)).model, "third")
                self.assertEqual(fake.calls, ["primary", "second", "third"])

    async def test_request_errors_do_not_try_other_models(self):
        for code in (400, 401):
            with self.subTest(code=code):
                service, fake, _ = make_service({"primary": api_error(code), "second": answer(), "third": answer()})
                with self.assertRaises(GeminiUnavailableError):
                    await service.chat(REQUEST)
                self.assertEqual(fake.calls, ["primary"])

    async def test_empty_answer_falls_back_without_cooldown(self):
        service, fake, router = make_service({"primary": [chunk(part(thought=True, text="thinking..."))], "second": answer(), "third": answer()})
        self.assertEqual((await service.chat(REQUEST)).model, "second")
        self.assertEqual(router.cooldown_left("primary"), 0)

    async def test_all_models_failing_raises(self):
        service, fake, _ = make_service({name: api_error(503) for name in MODELS})
        with self.assertRaises(GeminiUnavailableError):
            await service.chat(REQUEST)
        self.assertEqual(fake.calls, MODELS)

    async def test_when_every_model_is_cooling_only_the_earliest_is_tried(self):
        service, fake, router = make_service({name: api_error(429, retry="60s") for name in MODELS})
        with self.assertRaises(GeminiUnavailableError):
            await service.chat(REQUEST)

        router.mark_failed("second", 10)  # recovers first
        fake.calls.clear()
        fake.behaviour["second"] = answer("recovered")
        self.assertEqual((await service.chat(REQUEST)).model, "second")
        self.assertEqual(fake.calls, ["second"])

    async def test_failure_after_text_was_sent_does_not_switch_models(self):
        service, fake, _ = make_service({"primary": [chunk(part("Xin ")), api_error(503)], "second": answer(), "third": answer()})
        events = []
        with self.assertRaises(GeminiUnavailableError):
            async for event in service.stream(REQUEST):
                events.append(event)
        self.assertEqual(events, [{"type": "delta", "text": "Xin "}])
        self.assertEqual(fake.calls, ["primary"], "the user already saw text from this model")


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_text_streams_and_the_intent_tag_is_removed(self):
        service, _, _ = make_service({"primary": [
            chunk(part("Bạn đã chi ")), chunk(part("nhiều cho ăn uống.\n[[inte")), chunk(part("nt:spending_analysis]]"), tokens=42),
        ], "second": answer(), "third": answer()})
        events = await collect(service)
        text = "".join(e["text"] for e in events if e["type"] == "delta")
        self.assertEqual(text, "Bạn đã chi nhiều cho ăn uống.")
        self.assertEqual(events[-1], {"type": "done", "intent": "spending_analysis", "tokenUsage": 42,
                                      "model": "primary", "provider": "gemini"})

    async def test_function_calls_become_actions_and_are_capped(self):
        calls = [part(call=("create_transaction", {"type": "Expense", "amount": 45000 + i, "category": "Ăn uống"})) for i in range(7)]
        service, _, _ = make_service({"primary": [chunk(part(call=("delete_everything", {})), *calls)], "second": answer(), "third": answer()})
        reply = await service.chat(REQUEST)
        self.assertEqual(len(reply.actions), 5, "at most 5 actions per message")
        self.assertTrue(all(a.name == "create_transaction" for a in reply.actions), "unknown functions are ignored")
        self.assertEqual(reply.actions[0].args["amount"], 45000)
        self.assertEqual(reply.content, "")

    async def test_budget_proposal_is_one_structured_action_with_its_items(self):
        args = {"period": "2026-11", "summary": "Dựa trên 3 tháng gần nhất", "budgets": [
            {"category_id": "c1", "category": "Ăn uống", "amount": 3000000, "reason": "TB 3 tháng 3,2 tr"},
            {"category_id": "c2", "category": "Mua sắm", "amount": 1500000, "reason": "TB 3 tháng 1,7 tr"},
        ]}
        service, _, _ = make_service({"primary": [chunk(part("Đề xuất của mình:"), part(call=("propose_budgets", args)))],
                                      "second": answer(), "third": answer()})
        events = [e async for e in service.stream(REQUEST)]
        actions = [e for e in events if e["type"] == "action"]
        self.assertEqual(len(actions), 1, "the whole proposal is a single action")
        self.assertEqual(actions[0]["name"], "propose_budgets")
        self.assertEqual([b["category_id"] for b in actions[0]["args"]["budgets"]], ["c1", "c2"])
        # The stream format is unchanged: text still arrives as delta events, the proposal never inside the text.
        text = "".join(e["text"] for e in events if e["type"] == "delta")
        self.assertEqual(text, "Đề xuất của mình:")
        self.assertNotIn("category_id", text)

    def test_budget_proposal_tool_is_declared_and_only_proposes(self):
        from app.tools import ACTION_NAMES, MAX_BUDGET_ITEMS, TOOLS
        self.assertIn("propose_budgets", ACTION_NAMES)
        declaration = next(d for d in TOOLS[0].function_declarations if d.name == "propose_budgets")
        items = declaration.parameters_json_schema["properties"]["budgets"]["items"]
        self.assertEqual(set(items["required"]), {"category_id", "category", "amount", "reason"})
        self.assertEqual(MAX_BUDGET_ITEMS, 10, "must match AIActionTypes.MaxBudgetItems in the backend")

    async def test_thought_parts_are_never_shown(self):
        service, _, _ = make_service({"primary": [chunk(part("secret plan", thought=True), part("Trả lời"))], "second": answer(), "third": answer()})
        self.assertEqual((await service.chat(REQUEST)).content, "Trả lời")

    async def test_model_that_rejects_the_thinking_setting_is_retried_without_it(self):
        def flaky(config):
            return api_error(400, "Thinking level is not supported for this model.") if config.thinking_config else answer("no thinking")
        service, fake, _ = make_service({"gemini-3.9-flash": flaky, "bb": answer(), "cc": answer()},
                                        models=["gemini-3.9-flash", "bb", "cc"])
        self.assertEqual((await service.chat(REQUEST)).content, "no thinking")
        self.assertEqual(fake.calls, ["gemini-3.9-flash", "gemini-3.9-flash"])

        fake.calls.clear(); fake.configs.clear()
        await service.chat(REQUEST)
        self.assertEqual(fake.calls, ["gemini-3.9-flash"], "the rejection is remembered")
        self.assertIsNone(fake.configs[0].thinking_config)

    async def test_thinking_is_turned_down_per_model_family(self):
        service, fake, _ = make_service({"gemini-2.5-flash": answer(), "gemini-3.5-flash-lite": answer(), "cc": answer()},
                                        models=["gemini-2.5-flash", "gemini-3.5-flash-lite", "cc"])
        await service.chat(REQUEST)
        self.assertEqual(fake.configs[0].thinking_config.thinking_budget, 0)
        service._router.mark_failed("gemini-2.5-flash", 60)
        await service.chat(REQUEST)
        self.assertEqual(fake.configs[1].thinking_config.thinking_level.value.lower(), "minimal")


class IntentTagFilterTests(unittest.TestCase):
    def run_filter(self, pieces):
        f = IntentTagFilter()
        text = "".join(f.feed(p) for p in pieces) + f.finish()
        return text, f.intent

    def test_tag_split_across_pieces(self):
        self.assertEqual(self.run_filter(["Hello", "\n[", "[intent:budget_", "advice]]"]), ("Hello", "budget_advice"))

    def test_brackets_that_are_not_a_tag_pass_through(self):
        self.assertEqual(self.run_filter(["Xem [mục ", "này] và [[ghi chú]]"]), ("Xem [mục này] và [[ghi chú]]", None))

    def test_unknown_intent_is_ignored_and_unfinished_tag_dropped(self):
        self.assertEqual(self.run_filter(["A [[intent:hack]]"]), ("A", None))
        self.assertEqual(self.run_filter(["B\n[[intent:budg"]), ("B", None))


class ClassifyTests(unittest.TestCase):
    def test_daily_quota_waits_longer_than_per_minute_quota(self):
        daily = classify(api_error(429, message="Quota exceeded: GenerateRequestsPerDayPerProjectPerModel"))
        minute = classify(api_error(429, message="slow down"))
        self.assertGreater(daily.cooldown, minute.cooldown)

    def test_retry_delay_is_clamped(self):
        self.assertEqual(classify(api_error(429, retry="1s")).cooldown, 5)
        self.assertEqual(classify(api_error(429, retry="9000s")).cooldown, 300)

    def test_timeout_is_retryable_and_unknown_errors_are_not(self):
        self.assertIsNotNone(classify(TimeoutError()))
        self.assertIsNone(classify(ValueError("boom")))


if __name__ == "__main__":
    unittest.main()

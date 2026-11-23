"""Run from the ai-service folder:  python -m unittest discover -s tests -v"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google.genai import errors  # noqa: E402

from app.config import Settings  # noqa: E402
from app.gemini_service import GeminiChatService, GeminiUnavailableError  # noqa: E402
from app.model_router import ModelRouter, classify  # noqa: E402
from app.schemas import ChatRequest, GeminiChatOutput  # noqa: E402

MODELS = ["primary", "second", "third"]


def api_error(code: int, message: str = "x", retry: str | None = None) -> errors.APIError:
    details = [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry}] if retry else []
    body = {"error": {"code": code, "message": message, "status": "ERR", "details": details}}
    return (errors.ClientError if code < 500 else errors.ServerError)(code, body)


def good(text: str = "ok"):
    return SimpleNamespace(
        parsed=GeminiChatOutput(content=text, intent="general_finance"),
        text="", usage_metadata=SimpleNamespace(total_token_count=7),
    )


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class FakeModels:
    """`behaviour` maps a model name to a response or an exception to raise."""

    def __init__(self, behaviour: dict) -> None:
        self.behaviour = behaviour
        self.calls: list[str] = []

    def generate_content(self, model, contents, config):
        self.calls.append(model)
        result = self.behaviour[model]
        if isinstance(result, BaseException):
            raise result
        return result


def make_service(behaviour: dict, clock: FakeClock | None = None):
    settings = Settings(_env_file=None, gemini_api_key="k" * 12, service_key="s" * 32,
                        gemini_model_respond="primary", gemini_fallback_models="second,third")
    router = ModelRouter(MODELS, clock=clock or FakeClock())
    service = GeminiChatService(settings, router)
    fake = FakeModels(behaviour)
    service._client = SimpleNamespace(models=fake)
    return service, fake, router


REQUEST = ChatRequest(message="hi", history=[], financial_context="{}")


class ModelFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_quota_error_moves_to_next_model_and_skips_it_afterwards(self):
        service, fake, router = make_service({"primary": api_error(429, retry="37s"), "second": good(), "third": good()})

        first = await service.chat(REQUEST)
        self.assertEqual(first.model, "second")
        self.assertEqual(fake.calls, ["primary", "second"])
        self.assertEqual(router.cooldown_left("primary"), 37)

        fake.calls.clear()
        again = await service.chat(REQUEST)
        self.assertEqual(again.model, "second")
        self.assertEqual(fake.calls, ["second"], "a model in cooldown must not be called again")

    async def test_primary_is_used_again_after_cooldown(self):
        clock = FakeClock()
        service, fake, _ = make_service({"primary": api_error(429, retry="20s"), "second": good(), "third": good()}, clock)
        await service.chat(REQUEST)

        clock.now += 21
        fake.behaviour["primary"] = good("back")
        fake.calls.clear()
        answer = await service.chat(REQUEST)
        self.assertEqual((answer.model, answer.content), ("primary", "back"))

    async def test_missing_model_and_overload_fall_back(self):
        for code in (404, 503, 500):
            with self.subTest(code=code):
                service, fake, _ = make_service({"primary": api_error(code), "second": api_error(code), "third": good()})
                self.assertEqual((await service.chat(REQUEST)).model, "third")
                self.assertEqual(fake.calls, ["primary", "second", "third"])

    async def test_request_errors_do_not_try_other_models(self):
        for code in (400, 401):
            with self.subTest(code=code):
                service, fake, _ = make_service({"primary": api_error(code), "second": good(), "third": good()})
                with self.assertRaises(GeminiUnavailableError):
                    await service.chat(REQUEST)
                self.assertEqual(fake.calls, ["primary"])

    async def test_unusable_answer_falls_back_without_cooldown(self):
        empty = SimpleNamespace(parsed=None, text="", usage_metadata=None)
        service, fake, router = make_service({"primary": empty, "second": good(), "third": good()})
        self.assertEqual((await service.chat(REQUEST)).model, "second")
        self.assertEqual(router.cooldown_left("primary"), 0)

    async def test_all_models_failing_raises(self):
        service, fake, _ = make_service({name: api_error(503) for name in MODELS})
        with self.assertRaises(GeminiUnavailableError):
            await service.chat(REQUEST)
        self.assertEqual(fake.calls, MODELS)

    async def test_when_every_model_is_cooling_only_the_earliest_is_tried(self):
        clock = FakeClock()
        service, fake, router = make_service({name: api_error(429, retry="60s") for name in MODELS}, clock)
        with self.assertRaises(GeminiUnavailableError):
            await service.chat(REQUEST)

        router.mark_failed("second", 10)  # recovers first
        fake.calls.clear()
        fake.behaviour["second"] = good("recovered")
        self.assertEqual((await service.chat(REQUEST)).model, "second")
        self.assertEqual(fake.calls, ["second"])


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

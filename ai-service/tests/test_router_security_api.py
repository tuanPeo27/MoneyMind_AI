"""Run from the ai-service folder:  python -m unittest discover -s tests -v"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402
from google.genai import errors  # noqa: E402

from app import main  # noqa: E402
from app.config import Settings  # noqa: E402
from app.gemini_service import GeminiUnavailableError  # noqa: E402
from app.model_router import (  # noqa: E402
    DAILY_QUOTA_COOLDOWN,
    FORBIDDEN_COOLDOWN,
    MAX_RETRY_DELAY,
    MIN_RETRY_DELAY,
    OVERLOAD_COOLDOWN,
    QUOTA_COOLDOWN,
    UNAVAILABLE_COOLDOWN,
    ModelRouter,
    classify,
)
from app.schemas import ChatRequest, ChatResponse, ModelState  # noqa: E402
from app.security import require_service_key  # noqa: E402


def api_error(code: int, message: str = "x", retry: str | None = None) -> errors.APIError:
    details = [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry}] if retry else []
    body = {"error": {"code": code, "message": message, "status": "ERR", "details": details}}
    return (errors.ClientError if code < 500 else errors.ServerError)(code, body)


class Clock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


class ClassifyTests(unittest.TestCase):
    def test_codes_that_justify_trying_another_model(self):
        expected = {
            403: (FORBIDDEN_COOLDOWN, "forbidden"),
            404: (UNAVAILABLE_COOLDOWN, "not_found"),
            500: (OVERLOAD_COOLDOWN, "unavailable"),
            502: (OVERLOAD_COOLDOWN, "unavailable"),
            503: (OVERLOAD_COOLDOWN, "unavailable"),
            504: (OVERLOAD_COOLDOWN, "unavailable"),
        }
        for code, (cooldown, reason) in expected.items():
            with self.subTest(code=code):
                failure = classify(api_error(code))
                self.assertEqual((failure.cooldown, failure.reason), (cooldown, reason))

    def test_codes_that_another_model_cannot_fix(self):
        for code in (400, 401, 405, 409, 422):
            with self.subTest(code=code):
                self.assertIsNone(classify(api_error(code)))

    def test_quota_without_details_uses_the_default_cooldown(self):
        failure = classify(api_error(429))
        self.assertEqual((failure.cooldown, failure.reason), (QUOTA_COOLDOWN, "quota"))

    def test_retry_delay_is_used_when_within_limits(self):
        self.assertEqual(classify(api_error(429, retry="37s")).cooldown, 37)
        self.assertEqual(classify(api_error(429, retry="12.5s")).cooldown, 12.5)

    def test_retry_delay_is_clamped_to_the_limits(self):
        self.assertEqual(classify(api_error(429, retry="0s")).cooldown, MIN_RETRY_DELAY)
        self.assertEqual(classify(api_error(429, retry="1s")).cooldown, MIN_RETRY_DELAY)
        self.assertEqual(classify(api_error(429, retry="5000s")).cooldown, MAX_RETRY_DELAY)

    def test_unparseable_retry_delay_falls_back_to_the_default(self):
        for retry in ("soon", "10", "10m", "-5s"):
            with self.subTest(retry=retry):
                self.assertEqual(classify(api_error(429, retry=retry)).cooldown, QUOTA_COOLDOWN)

    def test_daily_quota_message_uses_the_long_cooldown(self):
        for message in ("Quota exceeded: RequestsPerDayPerProject", "You exceeded your limit per day"):
            with self.subTest(message=message):
                self.assertEqual(classify(api_error(429, message=message)).cooldown, DAILY_QUOTA_COOLDOWN)

    def test_daily_quota_wins_over_a_short_retry_hint(self):
        failure = classify(api_error(429, message="GenerateRequestsPerDay", retry="10s"))
        self.assertEqual(failure.cooldown, DAILY_QUOTA_COOLDOWN)

    def test_timeouts_are_retryable(self):
        failure = classify(TimeoutError())
        self.assertEqual((failure.cooldown, failure.reason), (OVERLOAD_COOLDOWN, "timeout"))

    def test_unrelated_exceptions_are_not_retryable(self):
        for exc in (ValueError("x"), KeyError("k"), RuntimeError("r"), OSError("o")):
            with self.subTest(exc=type(exc).__name__):
                self.assertIsNone(classify(exc))


class ModelRouterTests(unittest.TestCase):
    def test_an_empty_model_list_is_rejected(self):
        with self.assertRaises(ValueError):
            ModelRouter([])

    def test_all_models_are_candidates_initially_in_priority_order(self):
        self.assertEqual(ModelRouter(["a", "b", "c"]).candidates(), ["a", "b", "c"])

    def test_models_returns_a_copy(self):
        router = ModelRouter(["a", "b"])
        router.models.append("hacked")
        self.assertEqual(router.models, ["a", "b"])

    def test_the_input_list_is_copied(self):
        source = ["a", "b"]
        router = ModelRouter(source)
        source.append("c")
        self.assertEqual(router.models, ["a", "b"])

    def test_failed_model_is_skipped_until_the_cooldown_ends(self):
        clock = Clock()
        router = ModelRouter(["a", "b"], clock=clock)
        router.mark_failed("a", 30)
        self.assertEqual(router.candidates(), ["b"])
        clock.now += 29
        self.assertEqual(router.candidates(), ["b"])
        clock.now += 1
        self.assertEqual(router.candidates(), ["a", "b"])

    def test_cooldown_left_counts_down_and_never_goes_negative(self):
        clock = Clock()
        router = ModelRouter(["a"], clock=clock)
        router.mark_failed("a", 10)
        self.assertEqual(router.cooldown_left("a"), 10)
        clock.now += 4
        self.assertEqual(router.cooldown_left("a"), 6)
        clock.now += 100
        self.assertEqual(router.cooldown_left("a"), 0)

    def test_unknown_model_has_no_cooldown(self):
        self.assertEqual(ModelRouter(["a"]).cooldown_left("nope"), 0)

    def test_zero_or_negative_cooldown_is_ignored(self):
        router = ModelRouter(["a", "b"])
        router.mark_failed("a", 0)
        router.mark_failed("b", -5)
        self.assertEqual(router.candidates(), ["a", "b"])

    def test_mark_ok_clears_the_cooldown(self):
        router = ModelRouter(["a", "b"])
        router.mark_failed("a", 60)
        router.mark_ok("a")
        self.assertEqual(router.candidates(), ["a", "b"])

    def test_mark_ok_on_a_healthy_model_is_harmless(self):
        router = ModelRouter(["a"])
        router.mark_ok("a")
        self.assertEqual(router.candidates(), ["a"])

    def test_when_every_model_cools_down_only_the_earliest_recovering_one_is_offered(self):
        router = ModelRouter(["a", "b", "c"], clock=Clock())
        router.mark_failed("a", 50)
        router.mark_failed("b", 10)
        router.mark_failed("c", 30)
        self.assertEqual(router.candidates(), ["b"])

    def test_a_longer_cooldown_replaces_a_shorter_one(self):
        clock = Clock()
        router = ModelRouter(["a", "b"], clock=clock)
        router.mark_failed("a", 10)
        router.mark_failed("a", 40)
        self.assertEqual(router.cooldown_left("a"), 40)

    def test_single_model_is_always_offered(self):
        router = ModelRouter(["only"], clock=Clock())
        router.mark_failed("only", 500)
        self.assertEqual(router.candidates(), ["only"])


class ServiceKeyTests(unittest.IsolatedAsyncioTestCase):
    SETTINGS = Settings(_env_file=None, gemini_api_key="k" * 12, service_key="s" * 32)

    async def test_correct_key_is_accepted(self):
        self.assertIsNone(await require_service_key(x_service_key="s" * 32, settings=self.SETTINGS))

    async def test_wrong_key_is_rejected_with_401(self):
        with self.assertRaises(HTTPException) as caught:
            await require_service_key(x_service_key="x" * 32, settings=self.SETTINGS)
        self.assertEqual(caught.exception.status_code, 401)

    async def test_missing_key_is_rejected_with_401(self):
        with self.assertRaises(HTTPException) as caught:
            await require_service_key(x_service_key=None, settings=self.SETTINGS)
        self.assertEqual(caught.exception.status_code, 401)

    async def test_empty_key_is_rejected(self):
        with self.assertRaises(HTTPException):
            await require_service_key(x_service_key="", settings=self.SETTINGS)

    async def test_key_of_a_different_length_is_rejected(self):
        for key in ("s" * 31, "s" * 33, "s"):
            with self.subTest(length=len(key)), self.assertRaises(HTTPException):
                await require_service_key(x_service_key=key, settings=self.SETTINGS)

    async def test_key_that_only_differs_in_case_is_rejected(self):
        with self.assertRaises(HTTPException):
            await require_service_key(x_service_key="S" * 32, settings=self.SETTINGS)

    async def test_error_message_does_not_reveal_the_expected_key(self):
        with self.assertRaises(HTTPException) as caught:
            await require_service_key(x_service_key="x" * 32, settings=self.SETTINGS)
        self.assertNotIn("s" * 32, str(caught.exception.detail))


class FakeGemini:
    def __init__(self, reply=None, error=None, healthy="primary") -> None:
        self.reply = reply
        self.error = error
        self.healthy = healthy
        self.requests: list[ChatRequest] = []

    async def chat(self, request):
        self.requests.append(request)
        if self.error:
            raise self.error
        return self.reply

    async def is_healthy(self):
        return self.healthy

    def model_states(self):
        return [ModelState(name="primary", available=True)]


class EndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_chat_returns_the_service_answer(self):
        reply = ChatResponse(content="hello", intent="general_finance", model="primary")
        fake = FakeGemini(reply=reply)
        request = ChatRequest(message="hi")
        result = await main.chat(request, fake)
        self.assertIs(result, reply)
        self.assertEqual(fake.requests, [request])

    async def test_chat_provider_outage_becomes_503_without_provider_details(self):
        fake = FakeGemini(error=GeminiUnavailableError("api key AIza-secret rejected"))
        with self.assertRaises(HTTPException) as caught:
            await main.chat(ChatRequest(message="hi"), fake)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertNotIn("AIza-secret", str(caught.exception.detail))

    async def test_chat_unexpected_errors_are_not_swallowed(self):
        fake = FakeGemini(error=RuntimeError("bug"))
        with self.assertRaises(RuntimeError):
            await main.chat(ChatRequest(message="hi"), fake)

    async def test_health_reports_the_reachable_model_and_all_model_states(self):
        settings = Settings(_env_file=None, gemini_api_key="k" * 12, service_key="s" * 32)
        result = await main.health(settings, FakeGemini(healthy="primary"))
        self.assertEqual(result.status, "Healthy")
        self.assertEqual(result.model, "primary")
        self.assertEqual([m.name for m in result.models], ["primary"])

    async def test_health_is_503_when_no_model_is_reachable(self):
        settings = Settings(_env_file=None, gemini_api_key="k" * 12, service_key="s" * 32)
        with self.assertRaises(HTTPException) as caught:
            await main.health(settings, FakeGemini(healthy=None))
        self.assertEqual(caught.exception.status_code, 503)


class AppConfigurationTests(unittest.TestCase):
    def test_interactive_docs_and_openapi_are_disabled(self):
        self.assertIsNone(main.app.docs_url)
        self.assertIsNone(main.app.redoc_url)
        self.assertIsNone(main.app.openapi_url)

    def test_routes_are_chat_categorize_insights_and_health_only(self):
        routes = {(r.path, tuple(sorted(r.methods))) for r in main.app.routes if hasattr(r, "methods")}
        self.assertIn(("/v1/chat", ("POST",)), routes)
        self.assertIn(("/v1/chat/stream", ("POST",)), routes)
        self.assertIn(("/v1/categorize", ("POST",)), routes)
        self.assertIn(("/v1/insights", ("POST",)), routes)
        self.assertIn(("/health", ("GET",)), routes)
        self.assertEqual(len(routes), 5)

    def test_all_routes_require_the_service_key(self):
        for route in main.app.routes:
            if getattr(route, "path", "") in ("/v1/chat", "/v1/chat/stream", "/v1/categorize", "/v1/insights", "/health"):
                with self.subTest(path=route.path):
                    calls = [d.call for d in route.dependant.dependencies]
                    self.assertIn(require_service_key, calls)


if __name__ == "__main__":
    unittest.main()

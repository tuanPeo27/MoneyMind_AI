"""Run from the ai-service folder:  python -m unittest discover -s tests -v"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError  # noqa: E402

from app.config import Settings  # noqa: E402
from app.schemas import (  # noqa: E402
    ChatRequest,
    ChatResponse,
    ChatTurn,
    ProposedAction,
    HealthResponse,
    ModelState,
)

KEY = "k" * 12
SERVICE_KEY = "s" * 32


def make_settings(**overrides) -> Settings:
    values = {"gemini_api_key": KEY, "service_key": SERVICE_KEY}
    values.update(overrides)
    return Settings(_env_file=None, **values)


class SettingsValidationTests(unittest.TestCase):
    def test_valid_minimal_settings(self):
        settings = make_settings()
        self.assertEqual(settings.port, 8001)
        self.assertEqual(settings.host, "127.0.0.1")

    def test_api_key_must_be_at_least_10_characters(self):
        with self.assertRaises(ValidationError):
            make_settings(gemini_api_key="short")
        make_settings(gemini_api_key="x" * 10)

    def test_service_key_must_be_at_least_32_characters(self):
        with self.assertRaises(ValidationError):
            make_settings(service_key="s" * 31)
        make_settings(service_key="s" * 32)

    def test_secrets_are_not_shown_in_repr(self):
        text = repr(make_settings())
        self.assertNotIn(KEY, text)
        self.assertNotIn(SERVICE_KEY, text)

    def test_secret_values_can_be_read_explicitly(self):
        settings = make_settings()
        self.assertEqual(settings.gemini_api_key.get_secret_value(), KEY)
        self.assertEqual(settings.service_key.get_secret_value(), SERVICE_KEY)

    def test_port_bounds(self):
        for port in (0, -1, 65536):
            with self.subTest(port=port), self.assertRaises(ValidationError):
                make_settings(port=port)
        for port in (1, 8001, 65535):
            with self.subTest(port=port):
                self.assertEqual(make_settings(port=port).port, port)

    def test_request_timeout_bounds(self):
        for value in (4, 121):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                make_settings(request_timeout_seconds=value)
        for value in (5, 45, 120):
            with self.subTest(value=value):
                make_settings(request_timeout_seconds=value)

    def test_attempt_timeout_bounds(self):
        for value in (2, 61):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                make_settings(attempt_timeout_seconds=value)
        for value in (3, 25, 60):
            with self.subTest(value=value):
                make_settings(attempt_timeout_seconds=value)

    def test_max_output_tokens_bounds(self):
        for value in (255, 8193):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                make_settings(max_output_tokens=value)
        for value in (256, 2048, 8192):
            with self.subTest(value=value):
                make_settings(max_output_tokens=value)

    def test_unknown_settings_are_ignored(self):
        make_settings(something_else="x")


class ModelNameTests(unittest.TestCase):
    def test_valid_primary_names(self):
        for name in ("gemini-2.5-flash", "a1", "model_name.v2", "A" * 81):
            with self.subTest(name=name):
                self.assertEqual(make_settings(gemini_model_respond=name).gemini_model_respond, name)

    def test_invalid_primary_names(self):
        for name in ("", "a", "-bad", "has space", "x;rm -rf", "a" * 82, "tiền"):
            with self.subTest(name=name), self.assertRaises(ValidationError):
                make_settings(gemini_model_respond=name)

    def test_primary_name_is_trimmed(self):
        self.assertEqual(make_settings(gemini_model_respond="  gemini-x  ").gemini_model_respond, "gemini-x")

    def test_invalid_fallback_name_is_rejected(self):
        with self.assertRaises(ValidationError):
            make_settings(gemini_fallback_models="ok-model,bad name")

    def test_empty_fallback_list_is_allowed(self):
        self.assertEqual(make_settings(gemini_model_respond="primary", gemini_fallback_models="").models, ["primary"])


class ModelListTests(unittest.TestCase):
    def test_primary_comes_first_then_fallbacks_in_order(self):
        settings = make_settings(gemini_model_respond="aa", gemini_fallback_models="bb,cc")
        self.assertEqual(settings.models, ["aa", "bb", "cc"])

    def test_duplicates_are_removed_keeping_first_position(self):
        settings = make_settings(gemini_model_respond="aa", gemini_fallback_models="bb,aa,bb,cc")
        self.assertEqual(settings.models, ["aa", "bb", "cc"])

    def test_whitespace_and_empty_parts_are_ignored(self):
        settings = make_settings(gemini_model_respond="aa", gemini_fallback_models=" bb , ,cc ,")
        self.assertEqual(settings.models, ["aa", "bb", "cc"])

    def test_list_is_capped_at_six_models(self):
        fallbacks = ",".join(f"model-{i}" for i in range(10))
        self.assertEqual(len(make_settings(gemini_model_respond="primary", gemini_fallback_models=fallbacks).models), 6)

    def test_default_list_has_three_models(self):
        settings = Settings(_env_file=None, gemini_api_key=KEY, service_key=SERVICE_KEY,
                            gemini_model_respond="gemini-2.5-flash")
        self.assertEqual(settings.models[0], "gemini-2.5-flash")
        self.assertGreaterEqual(len(settings.models), 2)


class ChatRequestTests(unittest.TestCase):
    def test_minimal_request_uses_defaults(self):
        request = ChatRequest(message="hi")
        self.assertEqual(request.history, [])
        self.assertEqual(request.financial_context, "{}")
        self.assertIsNone(request.language)

    def test_message_length_bounds(self):
        for text in ("", "a" * 4001):
            with self.subTest(length=len(text)), self.assertRaises(ValidationError):
                ChatRequest(message=text)
        for text in ("a", "a" * 4000):
            with self.subTest(length=len(text)):
                ChatRequest(message=text)

    def test_message_is_required(self):
        with self.assertRaises(ValidationError):
            ChatRequest()

    def test_history_is_limited_to_30_turns(self):
        turns = [ChatTurn(role="user", content="x")] * 31
        with self.assertRaises(ValidationError):
            ChatRequest(message="hi", history=turns)
        ChatRequest(message="hi", history=turns[:30])

    def test_turn_roles(self):
        for role in ("user", "assistant", "model"):
            with self.subTest(role=role):
                self.assertEqual(ChatTurn(role=role, content="x").role, role)
        for role in ("system", "", "USER"):
            with self.subTest(role=role), self.assertRaises(ValidationError):
                ChatTurn(role=role, content="x")

    def test_turn_content_bounds(self):
        with self.assertRaises(ValidationError):
            ChatTurn(role="user", content="")
        with self.assertRaises(ValidationError):
            ChatTurn(role="user", content="a" * 8001)
        ChatTurn(role="user", content="a" * 8000)

    def test_language_values(self):
        for language in ("vi", "en", None):
            with self.subTest(language=language):
                self.assertEqual(ChatRequest(message="hi", language=language).language, language)
        for language in ("fr", "VI", "vie", ""):
            with self.subTest(language=language), self.assertRaises(ValidationError):
                ChatRequest(message="hi", language=language)

    def test_financial_context_limit(self):
        ChatRequest(message="hi", financial_context="x" * 30_000)
        with self.assertRaises(ValidationError):
            ChatRequest(message="hi", financial_context="x" * 30_001)

    def test_camel_case_json_from_the_dotnet_backend_is_accepted(self):
        request = ChatRequest.model_validate({
            "message": "hi",
            "history": [{"role": "user", "content": "before"}],
            "financialContext": "{\"a\":1}",
            "language": "vi",
        })
        self.assertEqual(request.financial_context, "{\"a\":1}")
        self.assertEqual(request.history[0].content, "before")

    def test_snake_case_names_also_work(self):
        self.assertEqual(ChatRequest(message="hi", financial_context="{}").financial_context, "{}")


class ResponseSchemaTests(unittest.TestCase):
    def test_chat_response_defaults(self):
        response = ChatResponse(content="hello")
        self.assertEqual(response.provider, "gemini")
        self.assertIsNone(response.intent)
        self.assertIsNone(response.token_usage)
        self.assertIsNone(response.model)

    def test_chat_response_serializes_with_camel_case_aliases(self):
        data = ChatResponse(content="hello", intent="x", token_usage=5, model="m").model_dump(by_alias=True)
        self.assertEqual(data["tokenUsage"], 5)
        self.assertEqual(data["model"], "m")
        self.assertNotIn("token_usage", data)

    def test_model_state_alias(self):
        data = ModelState(name="m", available=False, cooldown_seconds=12).model_dump(by_alias=True)
        self.assertEqual(data, {"name": "m", "available": False, "cooldownSeconds": 12})

    def test_model_state_defaults_to_no_cooldown(self):
        self.assertEqual(ModelState(name="m", available=True).cooldown_seconds, 0)

    def test_health_status_values(self):
        for status in ("Healthy", "Unhealthy"):
            with self.subTest(status=status):
                self.assertEqual(HealthResponse(status=status, model="m").status, status)
        with self.assertRaises(ValidationError):
            HealthResponse(status="Fine", model="m")

    def test_health_defaults(self):
        health = HealthResponse(status="Healthy", model="m")
        self.assertEqual(health.provider, "gemini")
        self.assertEqual(health.models, [])


class ProposedActionTests(unittest.TestCase):
    def test_args_default_to_empty(self):
        self.assertEqual(ProposedAction(name="add_transaction").args, {})

    def test_name_is_required(self):
        with self.assertRaises(ValidationError):
            ProposedAction(args={"amount": 1})

    def test_chat_response_carries_actions(self):
        response = ChatResponse(content="ok", actions=[ProposedAction(name="create_budget", args={"amount": 5})])
        self.assertEqual(response.actions[0].name, "create_budget")
        self.assertEqual(response.actions[0].args, {"amount": 5})

    def test_chat_response_actions_default_to_empty_and_are_not_shared(self):
        a, b = ChatResponse(content="a"), ChatResponse(content="b")
        self.assertEqual(a.actions, [])
        a.actions.append(ProposedAction(name="x"))
        self.assertEqual(b.actions, [])

if __name__ == "__main__":
    unittest.main()

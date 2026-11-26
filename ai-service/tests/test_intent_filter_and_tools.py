import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.intent_filter import INTENTS, IntentTagFilter  # noqa: E402
from app.tools import ACTION_NAMES, MAX_ACTIONS, TOOLS, thinking_for  # noqa: E402


def run(chunks):
    """Feeds the chunks and returns (visible text, detected intent)."""
    tag_filter = IntentTagFilter()
    out = "".join(tag_filter.feed(chunk) for chunk in chunks) + tag_filter.finish()
    return out, tag_filter.intent


class IntentTagFilterTests(unittest.TestCase):
    def test_plain_text_passes_through_untouched(self):
        self.assertEqual(run(["Xin chào ", "bạn"]), ("Xin chào bạn", None))

    def test_tag_at_the_end_is_removed_and_its_intent_reported(self):
        self.assertEqual(run(["Hãy tiết kiệm. [[intent:saving_goal]]"]), ("Hãy tiết kiệm.", "saving_goal"))

    def test_every_known_intent_is_recognised(self):
        for intent in INTENTS:
            with self.subTest(intent=intent):
                self.assertEqual(run([f"ok [[intent:{intent}]]"]), ("ok", intent))

    def test_unknown_intent_is_removed_but_not_reported(self):
        self.assertEqual(run(["ok [[intent:made_up]]"]), ("ok", None))

    def test_tag_split_across_many_chunks(self):
        text = "Trả lời. [[intent:budget_advice]]"
        for size in (1, 2, 3, 5, 7):
            with self.subTest(size=size):
                chunks = [text[i:i + size] for i in range(0, len(text), size)]
                # A space sent alone before the tag has already gone out; the backend trims the final text.
                visible, intent = run(chunks)
                self.assertEqual((visible.rstrip(), intent), ("Trả lời.", "budget_advice"))
                self.assertNotIn("[", visible)

    def test_nothing_of_the_tag_leaks_while_streaming(self):
        tag_filter = IntentTagFilter()
        shown = ""
        for chunk in ["Câu trả lời", " [[int", "ent:budget", "_advice]]"]:
            shown += tag_filter.feed(chunk)
            self.assertNotIn("[[", shown)
            self.assertNotIn("intent", shown)
        shown += tag_filter.finish()
        self.assertEqual(shown, "Câu trả lời")

    def test_text_is_not_held_back_forever(self):
        tag_filter = IntentTagFilter()
        self.assertEqual(tag_filter.feed("Xong rồi."), "Xong rồi.")

    def test_single_bracket_text_is_released_once_it_cannot_be_a_tag(self):
        self.assertEqual(run(["Giá [vnd] tăng"]), ("Giá [vnd] tăng", None))
        self.assertEqual(run(["Xem [1] và [2]."]), ("Xem [1] và [2].", None))

    def test_double_bracket_that_is_not_an_intent_tag_is_kept(self):
        self.assertEqual(run(["Mảng [[1, 2]] ở đây"]), ("Mảng [[1, 2]] ở đây", None))

    def test_unfinished_tag_at_the_end_is_dropped(self):
        self.assertEqual(run(["Xong. [[intent:bud"]), ("Xong.", None))
        self.assertEqual(run(["Xong. [["]), ("Xong.", None))

    def test_whitespace_before_the_tag_is_removed(self):
        self.assertEqual(run(["Xong.\n\n[[intent:general_finance]]"]), ("Xong.", "general_finance"))

    def test_tag_in_the_middle_is_removed_too(self):
        text, intent = run(["a [[intent:account_help]] b"])
        self.assertEqual(intent, "account_help")
        self.assertNotIn("[[", text)
        self.assertIn("a", text)
        self.assertIn("b", text)

    def test_last_tag_wins_when_there_are_two(self):
        self.assertEqual(run(["x [[intent:budget_advice]] y [[intent:saving_goal]]"])[1], "saving_goal")

    def test_empty_input(self):
        self.assertEqual(run([]), ("", None))
        self.assertEqual(run([""]), ("", None))

    def test_finish_twice_returns_nothing_the_second_time(self):
        tag_filter = IntentTagFilter()
        tag_filter.feed("ok [[")
        tag_filter.finish()
        self.assertEqual(tag_filter.finish(), "")

    def test_intents_match_the_backend_contract(self):
        self.assertEqual(set(INTENTS), {"general_finance", "spending_analysis", "budget_advice", "saving_goal",
                                        "transaction_help", "account_help", "out_of_scope"})


class ToolDeclarationTests(unittest.TestCase):
    def declarations(self):
        return TOOLS[0].function_declarations

    def test_action_names(self):
        self.assertEqual(ACTION_NAMES, {"create_transaction", "create_account", "create_category", "create_budget",
                                        "create_savings_goal", "contribute_to_goal", "propose_budgets"})

    def test_account_types_match_the_backend_enum(self):
        account = next(d for d in self.declarations() if d.name == "create_account")
        self.assertEqual(account.parameters_json_schema["properties"]["account_type"]["enum"], ["Cash", "Bank", "EWallet"])
        category = next(d for d in self.declarations() if d.name == "create_category")
        self.assertIn("never use it for a bank", category.description.lower())

    def test_names_match_the_backend_action_types(self):
        source = (Path(__file__).resolve().parents[2] / "backend" / "DTOs" / "AIActions.cs").read_text(encoding="utf-8")
        backend_names = set(re.findall(r'const string \w+ = "([a-z_]+)";', source))
        self.assertEqual(ACTION_NAMES, backend_names)

    def test_backend_and_service_agree_on_the_per_message_limit(self):
        source = (Path(__file__).resolve().parents[2] / "backend" / "DTOs" / "AIActions.cs").read_text(encoding="utf-8")
        self.assertEqual(MAX_ACTIONS, int(re.search(r"MaxPerMessage = (\d+);", source).group(1)))

    def test_single_tool_holds_every_declaration(self):
        self.assertEqual(len(TOOLS), 1)
        self.assertEqual({d.name for d in self.declarations()}, ACTION_NAMES)

    def test_each_declaration_has_a_description_and_required_fields_that_exist(self):
        for declaration in self.declarations():
            with self.subTest(name=declaration.name):
                schema = declaration.parameters_json_schema
                self.assertTrue(declaration.description)
                self.assertEqual(schema["type"], "object")
                self.assertTrue(schema["required"])
                for field in schema["required"]:
                    self.assertIn(field, schema["properties"])

    def test_argument_names_are_snake_case(self):
        for declaration in self.declarations():
            for field in declaration.parameters_json_schema["properties"]:
                with self.subTest(name=declaration.name, field=field):
                    self.assertRegex(field, r"^[a-z]+(_[a-z]+)*$")

    def test_transaction_and_category_types_are_limited_to_expense_or_income(self):
        for declaration in self.declarations():
            props = declaration.parameters_json_schema["properties"]
            if "type" in props:
                with self.subTest(name=declaration.name):
                    self.assertEqual(props["type"]["enum"], ["Expense", "Income"])

    def test_arguments_the_backend_reads_are_declared(self):
        # Mirrors the keys AIActionService.Normalize reads.
        expected = {
            "create_transaction": {"type", "amount", "category", "account", "date", "description"},
            "create_account": {"name", "account_type", "initial_balance"},
            "create_category": {"name", "type"},
            "create_budget": {"amount", "category", "start_date", "end_date", "alert_threshold"},
            "create_savings_goal": {"name", "target_amount", "deadline"},
            "contribute_to_goal": {"amount", "goal", "account"},
            "propose_budgets": {"period", "summary", "budgets"},
        }
        for declaration in self.declarations():
            with self.subTest(name=declaration.name):
                self.assertEqual(set(declaration.parameters_json_schema["properties"]), expected[declaration.name])


class ThinkingTests(unittest.TestCase):
    def test_gemini_25_uses_a_zero_budget(self):
        for model in ("gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"):
            with self.subTest(model=model):
                config = thinking_for(model)
                self.assertEqual(config.thinking_budget, 0)
                self.assertIsNone(config.thinking_level)

    def test_gemini_3_uses_the_minimal_level(self):
        for model in ("gemini-3-flash", "gemini-3.5-flash-lite"):
            with self.subTest(model=model):
                config = thinking_for(model)
                self.assertEqual(str(config.thinking_level).lower().split(".")[-1], "minimal")
                self.assertIsNone(config.thinking_budget)

    def test_other_models_get_no_setting(self):
        for model in ("gemini-2.0-flash", "gemini-1.5-pro", "other", ""):
            with self.subTest(model=model):
                self.assertIsNone(thinking_for(model))


if __name__ == "__main__":
    unittest.main()

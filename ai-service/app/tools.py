"""Functions Gemini may call to propose changes. Nothing is saved here: the backend shows each one to the user,
who confirms it before it is executed."""
from google.genai import types

MAX_ACTIONS = 5

_DATE = {"type": "string", "description": "Date as YYYY-MM-DD. Use FINANCIAL_CONTEXT.today for 'today'."}
_VND = {"type": "number", "description": "Amount in VND as a whole number, e.g. 45k = 45000, 1tr5 = 1500000."}

_DECLARATIONS = [
    types.FunctionDeclaration(
        name="create_transaction",
        description="Propose recording one income or expense.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["Expense", "Income"]},
                "amount": _VND,
                "category": {"type": "string", "description": "Exact name from FINANCIAL_CONTEXT.expenseCategories or incomeCategories, or one proposed with create_category in this turn."},
                "account": {"type": "string", "description": "Exact account name from FINANCIAL_CONTEXT.accounts, or one proposed with create_account in this turn. Omit if the user did not say."},
                "date": _DATE,
                "description": {"type": "string", "description": "Short note, e.g. 'Ăn trưa'."},
            },
            "required": ["type", "amount", "category"],
        },
    ),
    types.FunctionDeclaration(
        name="create_account",
        description="Propose a new account (wallet) that holds money: cash, a bank such as Vietcombank, or an "
                    "e-wallet such as MoMo. Banks and wallets are accounts, never categories.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "e.g. 'Vietcombank', 'MoMo'."},
                "account_type": {"type": "string", "enum": ["Cash", "Bank", "EWallet"]},
                "initial_balance": {**_VND, "description": "Only when the user states money already in it (e.g. 'số dư 2tr'). "
                                    "Omit otherwise. Never put the amount of a transaction here: money received into the "
                                    "account is a separate create_transaction, or it would be counted twice."},
            },
            "required": ["name", "account_type"],
        },
    ),
    types.FunctionDeclaration(
        name="create_category",
        description="Propose a new spending or income category (what the money is for, e.g. 'Thú cưng') when no "
                    "existing one fits. Never use it for a bank, wallet or account.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "type": {"type": "string", "enum": ["Expense", "Income"]},
            },
            "required": ["name", "type"],
        },
    ),
    types.FunctionDeclaration(
        name="create_budget",
        description="Propose a spending limit for an expense category over a date range (default: the current month).",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "category": {"type": "string", "description": "Exact name from FINANCIAL_CONTEXT.expenseCategories."},
                "amount": _VND,
                "start_date": _DATE,
                "end_date": _DATE,
                "alert_threshold": {"type": "integer", "description": "Percent of the budget that triggers a warning, 1-100. Default 80."},
            },
            "required": ["category", "amount"],
        },
    ),
    types.FunctionDeclaration(
        name="create_savings_goal",
        description="Propose a new savings fund with a target amount.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "target_amount": _VND,
                "deadline": _DATE,
            },
            "required": ["name", "target_amount"],
        },
    ),
    types.FunctionDeclaration(
        name="contribute_to_goal",
        description="Propose adding money to an existing savings fund.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "goal": {"type": "string", "description": "Exact fund name from FINANCIAL_CONTEXT.goals."},
                "amount": _VND,
                "account": {"type": "string", "description": "Account the money comes from. Omit to only record it in the fund."},
            },
            "required": ["goal", "amount"],
        },
    ),
]

TOOLS = [types.Tool(function_declarations=_DECLARATIONS)]
ACTION_NAMES = frozenset(d.name for d in _DECLARATIONS)

# Quick entry only records transactions (and a missing category or account for them).
CAPTURE_ACTION_NAMES = frozenset({"create_transaction", "create_category", "create_account"})
CAPTURE_TOOLS = [types.Tool(function_declarations=[d for d in _DECLARATIONS if d.name in CAPTURE_ACTION_NAMES])]


def lite_first(models: list[str]) -> list[str]:
    """Short structured tasks (quick entry, categorizing) run on lite models first to save the main model's quota."""
    return sorted(models, key=lambda name: "lite" not in name)


def thinking_for(model: str) -> types.ThinkingConfig | None:
    """
    Short financial answers do not need long reasoning, and thinking makes the first word arrive much later
    (gemini-2.5-flash: 3.5 s with default thinking, 0.7 s without). Each family accepts a different setting:
    2.5 models reject thinking_level, 3.x models reject thinking_budget=0.
    """
    if model.startswith("gemini-2.5"):
        return types.ThinkingConfig(thinking_budget=0)
    if model.startswith("gemini-3"):
        return types.ThinkingConfig(thinking_level="minimal")
    return None

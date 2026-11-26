from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=lambda value: "".join(
        word if index == 0 else word.capitalize()
        for index, word in enumerate(value.split("_"))
    ))


class ChatTurn(ApiModel):
    role: Literal["user", "assistant", "model"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(ApiModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=30)
    financial_context: str = Field(default="{}", max_length=30_000)
    # UI language of the user. When set, the answer must be written in it, whatever language the question uses.
    language: Literal["vi", "en"] | None = None
    # "capture": quick entry from the home screen. The model only turns the text into transactions, no conversation.
    mode: Literal["chat", "capture"] = "chat"


class CategoryOption(ApiModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=100)


class CategorizeRequest(ApiModel):
    description: str = Field(min_length=1, max_length=500)
    amount: float | None = None
    type: Literal["Expense", "Income"] = "Expense"
    categories: list[CategoryOption] = Field(min_length=1, max_length=200)


class CategorizeResponse(ApiModel):
    # One of the ids that were sent, or None when no category fits.
    category_id: str | None = None
    confidence: float = 0
    reason: str | None = None
    token_usage: int | None = None
    provider: str = "gemini"
    model: str | None = None


class InsightRequest(ApiModel):
    # Weekly numbers computed by the backend (JSON). The model only writes about them.
    facts: str = Field(min_length=2, max_length=20_000)
    language: Literal["vi", "en"] | None = None


class InsightItem(ApiModel):
    title: str
    content: str
    severity: Literal["info", "warning", "critical"] = "info"


class InsightAction(ApiModel):
    """Same argument names as the chat functions, so the backend can turn it into a confirmable action."""

    name: Literal["create_budget", "contribute_to_goal", "create_savings_goal"]
    category: str | None = None
    amount: float | None = None
    goal: str | None = None
    # create_savings_goal: the name of the new fund ("name" is already the action name).
    fund_name: str | None = None
    target_amount: float | None = None
    deadline: str | None = None


class InsightRecommendation(ApiModel):
    title: str
    description: str
    action: InsightAction | None = None


class InsightResponse(ApiModel):
    summary: str
    items: list[InsightItem] = Field(default_factory=list)
    recommendations: list[InsightRecommendation] = Field(default_factory=list)
    token_usage: int | None = None
    provider: str = "gemini"
    model: str | None = None


class ProposedAction(ApiModel):
    """A change the model wants to make. The backend shows it to the user, who confirms it before it is saved."""

    name: str
    args: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(ApiModel):
    content: str
    intent: str | None = None
    token_usage: int | None = None
    provider: str = "gemini"
    # The model that actually answered. It differs from the first choice when the system fell back.
    model: str | None = None
    actions: list[ProposedAction] = Field(default_factory=list)


class ModelState(ApiModel):
    name: str
    available: bool
    cooldown_seconds: int = 0


class HealthResponse(ApiModel):
    status: Literal["Healthy", "Unhealthy"]
    provider: str = "gemini"
    model: str
    models: list[ModelState] = Field(default_factory=list)

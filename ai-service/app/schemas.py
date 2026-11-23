from typing import Literal

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


class GeminiChatOutput(BaseModel):
    content: str = Field(description="A useful financial-assistant answer in the user's language.")
    intent: Literal[
        "general_finance",
        "spending_analysis",
        "budget_advice",
        "saving_goal",
        "transaction_help",
        "account_help",
        "out_of_scope",
    ]


class ChatResponse(ApiModel):
    content: str
    intent: str | None = None
    token_usage: int | None = None
    provider: str = "gemini"
    # The model that actually answered. It differs from the first choice when the system fell back.
    model: str | None = None


class ModelState(ApiModel):
    name: str
    available: bool
    cooldown_seconds: int = 0


class HealthResponse(ApiModel):
    status: Literal["Healthy", "Unhealthy"]
    provider: str = "gemini"
    model: str
    models: list[ModelState] = Field(default_factory=list)

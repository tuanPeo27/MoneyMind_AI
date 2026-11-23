from functools import lru_cache
import logging

from fastapi import Depends, FastAPI, HTTPException, status

from .config import Settings, get_settings
from .gemini_service import GeminiChatService, GeminiUnavailableError
from .schemas import ChatRequest, ChatResponse, HealthResponse
from .security import require_service_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="MoneyMind AI Service",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@lru_cache
def get_gemini() -> GeminiChatService:
    return GeminiChatService(get_settings())


@app.post("/v1/chat", response_model=ChatResponse, dependencies=[Depends(require_service_key)])
async def chat(request: ChatRequest, gemini: GeminiChatService = Depends(get_gemini)) -> ChatResponse:
    try:
        return await gemini.chat(request)
    except GeminiUnavailableError as exc:
        # Do not expose provider responses or credentials to the ASP.NET caller.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI provider is temporarily unavailable.",
        ) from exc


@app.get("/health", response_model=HealthResponse, dependencies=[Depends(require_service_key)])
async def health(
    settings: Settings = Depends(get_settings),
    gemini: GeminiChatService = Depends(get_gemini),
) -> HealthResponse:
    healthy = await gemini.is_healthy()
    if not healthy:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Gemini is unavailable.")
    return HealthResponse(status="Healthy", model=settings.gemini_model_respond)

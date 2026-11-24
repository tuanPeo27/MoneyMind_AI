import json
import logging
from functools import lru_cache

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import StreamingResponse

from .config import Settings, get_settings
from .gemini_service import GeminiChatService, GeminiUnavailableError
from .schemas import (CategorizeRequest, CategorizeResponse, ChatRequest, ChatResponse, HealthResponse, InsightRequest,
                      InsightResponse)
from .security import require_service_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="MoneyMind AI Service",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_UNAVAILABLE = "AI provider is temporarily unavailable."


@lru_cache
def get_gemini() -> GeminiChatService:
    return GeminiChatService(get_settings())


def _line(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


@app.post("/v1/chat", response_model=ChatResponse, dependencies=[Depends(require_service_key)])
async def chat(request: ChatRequest, gemini: GeminiChatService = Depends(get_gemini)) -> ChatResponse:
    try:
        return await gemini.chat(request)
    except GeminiUnavailableError as exc:
        # Do not expose provider responses or credentials to the ASP.NET caller.
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_UNAVAILABLE) from exc


@app.post("/v1/chat/stream", dependencies=[Depends(require_service_key)])
async def chat_stream(request: ChatRequest, gemini: GeminiChatService = Depends(get_gemini)):
    """
    Newline-delimited JSON events (see GeminiChatService.stream). When no model can start an answer this is a plain
    503. Once streaming has begun, a failure is reported as a final ``{"type": "error"}`` line.
    """
    events = gemini.stream(request)
    try:
        first = await anext(events)
    except GeminiUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_UNAVAILABLE) from exc

    async def body():
        yield _line(first)
        try:
            async for event in events:
                yield _line(event)
        except GeminiUnavailableError:
            yield _line({"type": "error", "message": _UNAVAILABLE})

    return StreamingResponse(body(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache"})


@app.post("/v1/categorize", response_model=CategorizeResponse, dependencies=[Depends(require_service_key)])
async def categorize(request: CategorizeRequest, gemini: GeminiChatService = Depends(get_gemini)) -> CategorizeResponse:
    try:
        return await gemini.categorize(request)
    except GeminiUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_UNAVAILABLE) from exc


@app.post("/v1/insights", response_model=InsightResponse, dependencies=[Depends(require_service_key)])
async def insights(request: InsightRequest, gemini: GeminiChatService = Depends(get_gemini)) -> InsightResponse:
    try:
        return await gemini.insights(request)
    except GeminiUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_UNAVAILABLE) from exc


@app.get("/health", response_model=HealthResponse, dependencies=[Depends(require_service_key)])
async def health(
    settings: Settings = Depends(get_settings),
    gemini: GeminiChatService = Depends(get_gemini),
) -> HealthResponse:
    reachable = await gemini.is_healthy()
    if reachable is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Gemini is unavailable.")
    return HealthResponse(status="Healthy", model=reachable, models=gemini.model_states())

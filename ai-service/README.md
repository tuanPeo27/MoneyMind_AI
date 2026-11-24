# MoneyMind AI Service

Internal FastAPI service that calls Google Gemini. The browser must never call this service directly.

## Setup

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python run.py
```

Set `GEMINI_API_KEY` to a key created in Google AI Studio. Set `SERVICE_KEY` to a random value of at least 32 characters, and use the same value in `backend/.env` as `AIService__ServiceKey`.

The service listens on `127.0.0.1:8001` by default. Internal calls require `X-Service-Key`.

- `POST /v1/chat/stream`: the answer as newline-delimited JSON while it is generated. The backend uses this one.
  - `{"type": "delta", "text"}`: the next piece of text.
  - `{"type": "action", "name", "args"}`: a change the model proposes (see below).
  - `{"type": "done", "intent", "tokenUsage", "model", "provider"}`: the end.
  - `{"type": "error", "message"}`: the model failed after the answer had started.
  - A plain HTTP 503 means no model could start an answer.
- `POST /v1/chat`: the same answer collected into one JSON response.
- `GET /health`: reports the first reachable model and the state of every model in the list.

## Proposed actions

The model can call five functions: `create_transaction`, `create_category`, `create_budget`, `create_savings_goal` and
`contribute_to_goal` (at most 5 per message; any other function name is ignored). This service saves nothing. It
passes the calls on, and the backend shows each one to the user, who confirms it before it is saved. When the model
only calls functions it writes no text, and the backend adds a short reply itself.

Text answers end with a tag such as `[[intent:budget_advice]]`, which drives the "Show me in my dashboard" link.
The tag is removed from the streamed text.

## Speed

Thinking is turned down for each model family: `thinking_budget=0` for 2.5 models, `thinking_level=minimal` for 3.x
models. Each family rejects the other setting with a 400. Measured with this key, the first words of
`gemini-2.5-flash` arrived after 0.7 s instead of 3.5 s. If a model rejects the setting, the service retries it once
without thinking and remembers that for that model.

## Model selection and fallback

Users do not choose a model. The system tries `GEMINI_MODEL_RESPOND` first, then each model in
`GEMINI_FALLBACK_MODELS`, in order. With streaming, it moves to the next model only while nothing has been sent yet.
A model that fails after the first words reports an error instead, because the user has already seen part of its
answer.

A model is skipped, and the next one is tried, when it returns:

| Error | Meaning | Skipped for |
|---|---|---|
| 429 | Quota used up | The retry delay Google sends (5 s to 5 min), 60 s if none, 30 min for a daily limit |
| 500, 502, 503, 504, timeout | Overloaded or down | 30 s |
| 404 | Model no longer available to this key | 1 hour |
| 403 | Not permitted for this key | 10 min |

A model that ends its answer without any text or function call is also skipped for that one request. Errors that
would be the same for every model (400 bad request, 401 bad key) stop immediately instead of trying more models.
After the skip time the model is tried again, so the first choice takes over again once its quota is back.

Check that a model works with this key before adding it. For example `gemini-2.5-flash-lite` is listed by the
API but returns 404 for new keys.

```powershell
python -m unittest discover -s tests -v
```

Gemini integration follows the official [Google Gen AI SDK](https://ai.google.dev/gemini-api/docs/quickstart) documentation. Documentation content was rephrased for compliance with licensing restrictions.

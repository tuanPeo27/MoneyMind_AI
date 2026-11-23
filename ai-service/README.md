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

- `POST /v1/chat`: chat with financial context and history. The response names the model that answered (`model`).
- `GET /health`: reports the first reachable model and the state of every model in the list.

## Model selection and fallback

Users do not choose a model. The system tries `GEMINI_MODEL_RESPOND` first, then each model in
`GEMINI_FALLBACK_MODELS`, in order.

A model is skipped, and the next one is tried, when it returns:

| Error | Meaning | Skipped for |
|---|---|---|
| 429 | Quota used up | The retry delay Google sends (5 s to 5 min), 60 s if none, 30 min for a daily limit |
| 500, 502, 503, 504, timeout | Overloaded or down | 30 s |
| 404 | Model no longer available to this key | 1 hour |
| 403 | Not permitted for this key | 10 min |

A model that answers in the wrong format is also skipped for that one request. Errors that would be the same for
every model (400 bad request, 401 bad key) stop immediately instead of trying more models. After the skip time
the model is tried again, so the first choice takes over again once its quota is back.

Check that a model works with this key before adding it. For example `gemini-2.5-flash-lite` is listed by the
API but returns 404 for new keys.

```powershell
python -m unittest discover -s tests -v
```

Gemini integration follows the official [Google Gen AI SDK](https://ai.google.dev/gemini-api/docs/quickstart) and [structured output](https://ai.google.dev/gemini-api/docs/structured-output) documentation. Documentation content was rephrased for compliance with licensing restrictions.

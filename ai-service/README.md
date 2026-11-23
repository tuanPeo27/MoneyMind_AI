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

- `POST /v1/chat`: chat with financial context and history.
- `GET /health`: verifies that the configured Gemini model is reachable.

Gemini integration follows the official [Google Gen AI SDK](https://ai.google.dev/gemini-api/docs/quickstart) and [structured output](https://ai.google.dev/gemini-api/docs/structured-output) documentation. Documentation content was rephrased for compliance with licensing restrictions.

# MoneyMind AI Service

AI service for the MoneyMind project, built with Python and FastAPI.

## Requirements

- Python 3.14+
- pip

## Project Structure

```text
ai-service/
├── app/
│   ├── main.py
│   └── schemas.py
├── requirements.txt
└── README.md
```

## Setup

Create a virtual environment:

```bash
python -m venv .venv
```

Activate on Windows CMD:

```cmd
.venv\Scripts\activate.bat
```

Install dependencies:

```bash
python -m pip install -r requirements.txt
```

## Run the application

```bash
python -m uvicorn app.main:app --reload
```

The server runs at:

http://127.0.0.1:8000

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | /health | Check service status |
| POST | /example | Example request/response |

## API Documentation

Swagger UI:

http://127.0.0.1:8000/docs

## Health Check Response

```json
{
  "status": "ok"
}
```

## Example Request

```json
{
  "message": "Hello MoneyMind"
}
```

## Example Response

```json
{
  "message": "Hello MoneyMind",
  "status": "success"
}
```
# Build context: ./ai-service   (docker build -t moneymind-ai ai-service)
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONIOENCODING=utf-8 \
    HOST=0.0.0.0 \
    PORT=8001

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app
COPY run.py ./

RUN useradd --create-home --uid 10001 appuser
USER appuser

# Keep this service on the private network only: it is reached by the backend with X-Service-Key.
EXPOSE 8001
CMD ["python", "run.py"]

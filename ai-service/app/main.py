from fastapi import FastAPI
from pydantic import BaseModel
from app.schemas import ExampleRequest, ExampleResponse

# Khởi tạo ứng dụng FastAPI
app = FastAPI(
    title="MoneyMind AI Service",
    description="AI service for MoneyMind project",
    version="0.1.0"
)


# Model phản hồi kiểm tra trạng thái
class HealthResponse(BaseModel):
    status: str


# API kiểm tra trạng thái hoạt động
@app.get("/health", response_model=HealthResponse)
def health_check():
    return {"status": "ok"}
# API mẫu kiểm tra request và response
@app.post("/example", response_model=ExampleResponse)
def example_api(request: ExampleRequest):
    return {
        "message": request.message,
        "status": "success"
    }
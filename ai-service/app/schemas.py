from pydantic import BaseModel

# Dữ liệu người dùng gửi lên
class ExampleRequest(BaseModel):
    message: str

# Dữ liệu API trả về
class ExampleResponse(BaseModel):
    message: str
    status: str
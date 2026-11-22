# MoneyMind AI – Development Setup

Tài liệu hướng dẫn thành viên mới cài đặt môi trường phát triển và chạy dự án MoneyMind AI trên Windows.

## 1. Yêu cầu môi trường

| Công cụ | Phiên bản / yêu cầu |
|---|---|
| .NET SDK | .NET 10 |
| SQL Server | SQL Server hoặc SQL Server Express |
| SQL Server Management Studio (SSMS) | Khuyến nghị để quản lý database |
| Git | Để clone và quản lý source code |
| Visual Studio Code / Visual Studio | IDE tùy chọn |

**Lưu ý:**
- Backend hiện tại sử dụng ASP.NET Core và Entity Framework Core.
- Python AI service và frontend cần được cập nhật hướng dẫn riêng khi xác nhận nhánh source code và phiên bản tương ứng.
- Các phiên bản ghi trong bảng là yêu cầu hoặc môi trường đã kiểm tra, không phải tất cả đều đã được xác minh trên mọi máy.

## 2. Clone source code

Mở Terminal và chạy:

```bash
git clone https://github.com/tuanPeo27/MoneyMind_AI.git
cd MoneyMind_AI
```

## 3. Cài đặt Backend

### 3.1. Kiểm tra .NET SDK

Kiểm tra phiên bản .NET:

```bash
dotnet --version
```

Dự án hiện sử dụng target framework `net10.0`, vì vậy cần cài .NET 10 SDK.

### 3.2. Khôi phục các package

Di chuyển vào thư mục backend:

```bash
cd backend
```

Chạy:

```bash
dotnet restore
```

Lệnh này tải và khôi phục các package cần thiết được khai báo trong `backend.csproj`.

### 3.3. Cấu hình biến môi trường

Sao chép file mẫu:

```bash
copy .env.example .env
```

Mở file `.env` và điền các thông tin cần thiết.

Các biến quan trọng:

```env
# Database
ConnectionStrings__DefaultConnection="Server=localhost;Database=MoneyMindAI;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"

# JWT - cần khóa ngẫu nhiên tối thiểu 32 ký tự
Jwt__Key="YOUR_RANDOM_SECRET_KEY_AT_LEAST_32_CHARACTERS"

# Admin account (optional)
Seed__AdminEmail="admin@example.com"
Seed__AdminPassword="YOUR_ADMIN_PASSWORD"
Seed__AdminFullName="System Admin"

# Google Sign-In (optional)
Google__ClientId=""

# SMTP (optional)
Smtp__Host=""
Smtp__Port=587
Smtp__EnableSsl=true
Smtp__Username=""
Smtp__Password=""
Smtp__FromAddress=""
Smtp__FromName="MoneyMind AI"
```

**Lưu ý:**
- Nếu sử dụng SQL Server Express, hãy điều chỉnh `Server` thành `localhost\\SQLEXPRESS` nếu đó là tên instance trên máy của bạn.
- `Jwt__Key` phải có tối thiểu 32 ký tự.
- Google OAuth và SMTP có thể để trống nếu chưa sử dụng các chức năng tương ứng.
- Không chia sẻ mật khẩu, JWT key hoặc thông tin đăng nhập thật.
- Không commit file `.env` lên Git. Chỉ commit `.env.example`.

### 3.4. Cài đặt Entity Framework CLI

Cài công cụ EF Core CLI nếu máy chưa có:

```bash
dotnet tool install --global dotnet-ef --version 10.0.0
```

Kiểm tra:

```bash
dotnet ef --version
```

### 3.5. Tạo hoặc cập nhật Database

Đảm bảo SQL Server đang chạy, sau đó thực hiện:

```bash
dotnet ef database update
```

Lệnh này áp dụng các migration có sẵn và tạo/cập nhật database.

### 3.6. Chạy Backend

```bash
dotnet run
```

Backend mặc định chạy tại:

- API: http://localhost:5146
- Swagger: http://localhost:5146/swagger

Mở Swagger để xem danh sách API và thử gửi request.

### 3.7. Kiểm tra Backend

Gửi request:

```http
GET http://localhost:5146/api/health
```

Kết quả mong đợi:

```json
{
  "status": "Healthy",
  "checkedAt": "..."
}
```

HTTP status code mong đợi: `200 OK`.

## 4. Cấu hình Database

Backend sử dụng SQL Server thông qua Entity Framework Core.

Ví dụ connection string cho SQL Server Express:

```env
ConnectionStrings__DefaultConnection="Server=localhost\\SQLEXPRESS;Database=MoneyMindAI;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
```

Nếu sử dụng SQL Server instance khác, cần thay đổi giá trị `Server` tương ứng.

## 5. Một số lỗi thường gặp

### Không kết nối được Database

- Kiểm tra dịch vụ SQL Server đã chạy chưa.
- Kiểm tra tên instance trong connection string.
- Kiểm tra quyền truy cập database.

### Thiếu JWT Key

Kiểm tra biến `Jwt__Key` trong file `.env`.

Khóa cần có ít nhất 32 ký tự.

### Không tìm thấy lệnh dotnet ef

Kiểm tra công cụ:

```bash
dotnet ef --version
```

Nếu chưa cài, thực hiện lại bước cài đặt Entity Framework CLI.

### Backend không chạy được

Thử khôi phục package:

```bash
dotnet restore
```

Sau đó chạy lại:

```bash
dotnet run
```

## 6. Bảo mật và Git

- Không commit file `.env`.
- Không đưa mật khẩu hoặc secret thật vào source code.
- Sử dụng `.env.example` để chia sẻ tên biến môi trường và giá trị mẫu.
- Không commit các thư mục build như `bin/`, `obj/`, `.venv/`, `node_modules/`.

## 7. Trạng thái hướng dẫn

| Thành phần | Trạng thái |
|---|---|
| ASP.NET Core Backend | Đã kiểm tra chạy thành công |
| SQL Server Database | Đã kiểm tra tạo database và chạy migration |
| Swagger | Đã mở thành công |
| Health API | Đã nhận HTTP 200 |
| Frontend | Chưa xác minh cấu trúc và phiên bản trên nhánh main |
| Python AI Service | Chưa xác minh cấu trúc và phiên bản trên nhánh main |

Tài liệu sẽ được cập nhật khi các thành phần frontend và AI service được tích hợp hoặc xác nhận phiên bản chính thức.
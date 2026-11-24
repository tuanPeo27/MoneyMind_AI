# 🛠️ MoneyMind AI - Development Setup

Tài liệu này hướng dẫn thiết lập môi trường phát triển và chạy hệ thống
**MoneyMind AI** trên Windows.

Hệ thống gồm ba process cần chạy đồng thời:

```text
React/Vite  ──>  ASP.NET Core API  ──>  Python/FastAPI
                                      └──>  Google Gemini
                         │
                         └──> SQL Server
```

## 📋 Mục lục

1. [Yêu cầu môi trường](#1-yêu-cầu-môi-trường)
2. [Cấu hình local](#2-cấu-hình-local)
3. [Thiết lập database](#3-thiết-lập-database)
4. [Chạy AI service](#4-chạy-ai-service)
5. [Chạy backend](#5-chạy-backend)
6. [Chạy frontend](#6-chạy-frontend)
7. [Google sign-in](#7-google-sign-in)
8. [Chạy test](#8-chạy-test)
9. [Bảng lệnh nhanh](#9-bảng-lệnh-nhanh)
10. [Xử lý lỗi thường gặp](#10-xử-lý-lỗi-thường-gặp)

---

## 1. Yêu cầu môi trường

| Công cụ | Phiên bản khuyến nghị | Kiểm tra |
|---|---|---|
| Windows | 10/11 | - |
| .NET SDK | 10.0 trở lên | `dotnet --version` |
| SQL Server | 2019+ hoặc Express | SQL Server Configuration Manager |
| Node.js | 20 trở lên | `node --version` |
| pnpm | 9 trở lên | `pnpm --version` |
| Python | 3.11 trở lên | `python --version` |
| Git | Phiên bản hiện tại | `git --version` |
| EF Core CLI | 10.0.0 | `dotnet ef --version` |

> SQL Server Management Studio là tùy chọn, nhưng hữu ích để kiểm tra database,
> dữ liệu seeding và migration.

### Clone source

```powershell
git clone https://github.com/tuanPeo27/MoneyMind_AI.git
cd MoneyMind_AI
```

---

## 2. Cấu hình local

Tạo ba file cấu hình từ file mẫu:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item ai-service/.env.example ai-service/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Các file này bị git ignore và không được commit.

### 2.1 Cấu hình backend

Mở `backend/.env` và cấu hình các giá trị bắt buộc:

```dotenv
ConnectionStrings__DefaultConnection="Server=localhost;Database=MoneyMindAI;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"

Jwt__Key="<at least 32 random characters>"
Encryption__MasterKey="<base64-encoded 32-byte key>"
AIService__ServiceKey="<at least 32 random characters>"
```

#### Kết nối SQL Server Express

```dotenv
ConnectionStrings__DefaultConnection="Server=localhost\SQLEXPRESS;Database=MoneyMindAI;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
```

#### Tạo khóa Base64 cho mã hóa dữ liệu

```powershell
[Convert]::ToBase64String(
    [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
```

#### Tạo khóa ngẫu nhiên cho JWT và AI service

```powershell
[Convert]::ToHexString(
    [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
```

### 2.2 Cấu hình tùy chọn của backend

```dotenv
# Tài khoản Admin do seeder tạo
Seed__AdminEmail="admin@example.com"
Seed__AdminPassword="<strong password>"
Seed__AdminFullName="System Admin"

# Google OAuth Web application
Google__ClientId=""

# SMTP
Smtp__Host=""
Smtp__Port=587
Smtp__EnableSsl=true
Smtp__Username=""
Smtp__Password=""
Smtp__FromAddress=""
Smtp__FromName="MoneyMind AI"

# CORS
Cors__AllowedOrigins__0=http://localhost:5173
Cors__AllowedOrigins__1=http://localhost:3000
```

<table>
<tr><td>🔑</td><td><strong>Seeder admin</strong></td><td>Chỉ tạo tài khoản khi đủ email và password</td></tr>
<tr><td>📧</td><td><strong>SMTP</strong></td><td>Để trống Host để ghi reset link vào log thay vì gửi mail</td></tr>
<tr><td>🌐</td><td><strong>Google</strong></td><td>Chỉ cần khi sử dụng đăng nhập Google</td></tr>
<tr><td>🔒</td><td><strong>CORS</strong></td><td>Không bắt buộc khi dùng proxy Vite mặc định</td></tr>
</table>

### 2.3 Cấu hình AI service

Mở `ai-service/.env`:

```dotenv
GEMINI_API_KEY="<Google Gemini API key>"
GEMINI_MODEL_RESPOND="gemini-2.5-flash"
GEMINI_FALLBACK_MODELS="gemini-3.5-flash-lite,gemini-3.1-flash-lite"
SERVICE_KEY="<exactly the same as AIService__ServiceKey>"
HOST="127.0.0.1"
PORT=8001
REQUEST_TIMEOUT_SECONDS=45
ATTEMPT_TIMEOUT_SECONDS=25
MAX_OUTPUT_TOKENS=2048
```

> [!IMPORTANT]
> `AIService__ServiceKey` trong `backend/.env` phải hoàn toàn giống
> `SERVICE_KEY` trong `ai-service/.env`.

Model trong danh sách có thể thay đổi trạng thái theo API key.
Kiểm tra model trước khi đưa vào fallback.

### 2.4 Cấu hình frontend

File `frontend/.env.local`:

```dotenv
# Để trống để dùng proxy Vite
VITE_API_URL=

# Google OAuth Web client ID
VITE_GOOGLE_CLIENT_ID=
```

Khi để `VITE_API_URL` trống, Vite chuyển mọi request `/api`
tới `http://localhost:5146`.

---

## 3. Thiết lập database

### 3.1 Cài EF Core CLI

```powershell
dotnet tool install --global dotnet-ef --version 10.0.0
dotnet ef --version
```

### 3.2 Khôi phục package và cập nhật database

```powershell
cd backend
dotnet restore
dotnet ef database update
```

Migration sẽ tạo/cập nhật database theo connection string trong `backend/.env`.

### 3.3 Dữ liệu seeding

Lần khởi động đầu tiên, seeder tạo:

- Role `Admin`
- Role `User`
- Danh mục thu/chi mặc định
- Hạn mức tin nhắn AI mặc định
- Tài khoản admin nếu đã cấu hình seed credentials

Seeder có thể chạy lặp lại và không ghi đè dữ liệu đã tồn tại.

---

## 4. Chạy AI service

Mở terminal thứ nhất:

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python run.py
```

Khi khởi động thành công:

```text
http://127.0.0.1:8001
```

### Kiểm tra AI service

```powershell
$headers = @{ "X-Service-Key" = "<SERVICE_KEY>" }
Invoke-RestMethod `
    -Uri "http://127.0.0.1:8001/health" `
    -Headers $headers
```

AI service là thành phần nội bộ. Không cho trình duyệt hoặc mạng bên ngoài gọi trực tiếp.

---

## 5. Chạy backend

Mở terminal thứ hai:

```powershell
cd backend
dotnet restore
dotnet build
dotnet run --launch-profile http
```

### Các endpoint phát triển

| Thành phần | Địa chỉ |
|---|---|
| Backend API | <http://localhost:5146> |
| Swagger UI | <http://localhost:5146/swagger> |
| OpenAPI document | <http://localhost:5146/openapi/v1.json> |
| Health check | <http://localhost:5146/api/health> |
| Notification hub | `ws://localhost:5146/hubs/notifications` |

### Kiểm tra backend

```powershell
Invoke-RestMethod -Uri "http://localhost:5146/api/health"
```

Kết quả mong đợi:

```json
{
  "status": "Healthy",
  "checkedAt": "..."
}
```

Database không kết nối được sẽ trả HTTP `503`.

---

## 6. Chạy frontend

Mở terminal thứ ba:

```powershell
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Mở trình duyệt:

```text
http://localhost:5173
```

### Build production bundle

```powershell
pnpm build
pnpm preview
```

Vite proxy mặc định chuyển request `/api` tới backend
`http://localhost:5146`.

---

## 7. Google sign-in

<table>
<tr><th>Bước</th><th>Thao tác</th></tr>
<tr><td>1</td><td>Tạo OAuth 2.0 client loại <strong>Web application</strong></td></tr>
<tr><td>2</td><td>Thêm <code>http://localhost:5173</code> vào authorized JavaScript origins</td></tr>
<tr><td>3</td><td>Đặt <code>Google__ClientId</code> trong <code>backend/.env</code></td></tr>
<tr><td>4</td><td>Đặt <code>VITE_GOOGLE_CLIENT_ID</code> trong <code>frontend/.env.local</code></td></tr>
<tr><td>5</td><td>Khởi động lại frontend và backend</td></tr>
</table>

Hai giá trị client ID phải cùng một OAuth client. Client ID có thể công khai trên frontend,
nhưng credential và secret không được đưa ra browser.

---

## 8. Chạy test

### AI service

```powershell
cd ai-service
.\.venv\Scripts\Activate.ps1
python -m unittest discover -s tests -v
```

Test hiện bao phủ:

- Fallback model
- Quota 429 và cooldown
- Timeout và lỗi provider
- Response AI không hợp lệ
- Tất cả model cùng lỗi

### Backend

Repository chưa có test project. Khi bổ sung test, ưu tiên integration test cho:

- Đăng ký, đăng nhập và refresh token
- Session và logout
- Quyền truy cập dữ liệu theo người dùng
- Giao dịch, ngân sách và mục tiêu
- Dashboard và báo cáo
- AI quota
- Role `Admin`

### Frontend

Repository chưa có Vitest hoặc Playwright. Khi cấu hình test runner, bắt đầu với:

- Authentication redirect
- CRUD giao dịch
- CRUD ngân sách
- Mở/tạo hội thoại AI
- Điều hướng role Admin

---

## 9. Bảng lệnh nhanh

<details>
<summary><strong>Backend commands</strong></summary>

```powershell
cd backend
dotnet restore
dotnet build
dotnet run --launch-profile http
dotnet ef migrations add <MigrationName>
dotnet ef database update
dotnet ef migrations remove
```

</details>

<details>
<summary><strong>Frontend commands</strong></summary>

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm preview
```

</details>

<details>
<summary><strong>AI service commands</strong></summary>

```powershell
cd ai-service
.\.venv\Scripts\Activate.ps1
python run.py
python -m unittest discover -s tests -v
```

</details>

---

## 10. Xử lý lỗi thường gặp

### ❌ Thiếu hoặc sai SDK .NET

```powershell
dotnet --list-sdks
dotnet --version
```

Cài .NET 10 SDK và mở lại terminal hoặc VS Code.

### ❌ Backend không tìm thấy database connection

Kiểm tra `backend/.env` có:

```dotenv
ConnectionStrings__DefaultConnection="..."
```

Biến môi trường host có ưu tiên cao hơn file `.env`.

### ❌ Thiếu JWT hoặc encryption key

Đảm bảo:

- `Jwt__Key`: tối thiểu 32 ký tự
- `Encryption__MasterKey`: Base64 của 32 byte
- `AIService__ServiceKey`: tối thiểu 32 ký tự

> [!CAUTION]
> Không đổi `Encryption__MasterKey` sau khi dữ liệu đã được mã hóa.

### ❌ Không kết nối SQL Server

Kiểm tra lần lượt:

- SQL Server service đang chạy
- Tên instance chính xác
- Quyền truy cập của Windows hoặc SQL login
- Firewall cho phép kết nối local
- Connection string có `TrustServerCertificate=True`

SQL Server Express thường dùng:

```text
localhost\SQLEXPRESS
```

### ❌ Không tìm thấy `dotnet ef`

```powershell
dotnet tool install --global dotnet-ef --version 10.0.0
dotnet ef --version
```

Nếu đã cài nhưng không tìm thấy lệnh, kiểm tra thư mục tools:

```powershell
& "$env:USERPROFILE\.dotnet\tools\dotnet-ef.exe" --version
```

### ❌ Frontend không gọi được API

Kiểm tra:

1. Backend đang chạy trên port `5146`
2. Frontend đang chạy trên port `5173`
3. `VITE_API_URL` để trống cho setup proxy mặc định
4. Restart Vite sau khi sửa `.env.local`

### ❌ AI request thất bại

Kiểm tra:

1. `GEMINI_API_KEY` hợp lệ
2. `SERVICE_KEY` bằng `AIService__ServiceKey`
3. AI service đang chạy tại `127.0.0.1:8001`
4. Model Gemini được API key cấu hình hỗ trợ
5. Backend không timeout hoặc sai `AIService:BaseUrl`

### ❌ Không gửi được email reset password

Trong môi trường local, để `Smtp__Host` trống để reset link được ghi log.
Muốn gửi mail thật, cấu hình đầy đủ SMTP host, port, SSL, username,
password và from address.

---

## 🔐 Quy tắc bảo mật

- Không commit `.env`, `.env.local`, private key hoặc credential
- Dùng secret riêng cho development và production
- Không đưa Gemini key hoặc SMTP password vào frontend
- Không thay đổi master encryption key sau khi dữ liệu tồn tại
- Mọi thay đổi authentication, authorization hoặc tính toán tài chính cần được review
- Production bắt buộc dùng HTTPS và CORS giới hạn

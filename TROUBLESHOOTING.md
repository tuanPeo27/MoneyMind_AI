# 🩺 MoneyMind AI: Tìm và sửa lỗi

Tài liệu cho dev: lỗi thường gặp, cách xác định lỗi ở phần nào, và cách sửa. Mọi mục ở đây đều là lỗi đã gặp thật
trong dự án hoặc bẫy có trong code hiện tại.

- Cài đặt lần đầu: [DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md). Quy ước code: [AGENTS.md](./AGENTS.md).
- Lệnh viết cho **PowerShell trên Windows**, chạy từ thư mục gốc repo trừ khi ghi khác.

## Mục lục

1. [Quy trình chẩn đoán](#1-quy-trình-chẩn-đoán)
2. [Kiểm tra nhanh 1 phút](#2-kiểm-tra-nhanh-1-phút)
3. [Tra theo thông báo trên giao diện](#3-tra-theo-thông-báo-trên-giao-diện)
4. [Database và migration](#4-database-và-migration)
5. [Backend](#5-backend)
6. [Đăng nhập và phân quyền](#6-đăng-nhập-và-phân-quyền)
7. [Trợ lý AI](#7-trợ-lý-ai)
8. [Thao tác AI và đề xuất ngân sách](#8-thao-tác-ai-và-đề-xuất-ngân-sách)
9. [Frontend](#9-frontend)
10. [Số liệu tài chính sai](#10-số-liệu-tài-chính-sai)
11. [Test và CI](#11-test-và-ci)
12. [Sau khi pull hoặc merge](#12-sau-khi-pull-hoặc-merge)
13. [Docker và deploy](#13-docker-và-deploy)
14. [Bẫy Windows / PowerShell](#14-bẫy-windows--powershell)
15. [Phòng lỗi khi thêm tính năng](#15-phòng-lỗi-khi-thêm-tính-năng)
16. [Mẫu báo lỗi](#16-mẫu-báo-lỗi)

---

## 1. Quy trình chẩn đoán

Làm theo thứ tự. Phần lớn lỗi dừng ở bước 1 hoặc 2.

1. **Cả 4 thứ có đang chạy không?** SQL Server, backend (5146), ai-service (8001), frontend (5173 dev / 4173 preview).
   Chat báo 503 hay trang trống thường chỉ là một phần đang tắt.
2. **Lỗi ở tầng nào?** Mở DevTools → Network, xem request lỗi:
   - Không có request nào được gửi → lỗi frontend (xem Console).
   - Request trả status HTTP → đọc `detail` trong body (ProblemDetails, tiếng Việt) và tra [mục 3](#3-tra-theo-thông-báo-trên-giao-diện).
   - Status `0` / `(failed)` → backend tắt, sai cổng, hoặc bị CORS chặn.
3. **Đọc log đúng chỗ:**
   - Backend: cửa sổ console của `dotnet run`. Lỗi 500 luôn có dòng `Unhandled exception for {Method} {Path}` kèm stack trace
     (`Middleware/ExceptionHandlingMiddleware.cs`). Trình duyệt chỉ thấy `An unexpected error occurred.`
   - ai-service: console của `python run.py` (mỗi lần gọi Gemini, model nào lỗi, chuyển model dự phòng).
   - Database: bảng `AIProcessingLogs` (mỗi lần gọi AI, `Status`, `ErrorCode`), `ServiceHealthChecks`, `AuditLogs`.
4. **Tái hiện bằng Swagger** (`http://localhost:5146/swagger`, bấm Authorize với access token). Nếu Swagger cũng lỗi thì
   lỗi ở backend, nếu không thì ở frontend.
5. **Viết test tái hiện** trước khi sửa (xem [mục 11](#11-test-và-ci)), rồi chạy đủ 4 lệnh kiểm tra.

## 2. Kiểm tra nhanh 1 phút

```powershell
# Cổng nào đang mở, tiến trình nào giữ
Get-NetTCPConnection -LocalPort 5146,8001,5173,4173 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { $p = Get-Process -Id $_.OwningProcess; "$($_.LocalPort) -> $($p.Id) $($p.ProcessName)" }

# Backend + database: 200 {"status":"Healthy"}; 503 {"status":"Unhealthy"} nghĩa là backend chạy nhưng không vào được DB
Invoke-WebRequest http://localhost:5146/api/health -UseBasicParsing | Select StatusCode, Content

# ai-service: không có header thì 401 là BÌNH THƯỜNG (nghĩa là service đang chạy)
Invoke-WebRequest http://localhost:8001/health -Headers @{ 'X-Service-Key' = '<SERVICE_KEY trong ai-service/.env>' } -UseBasicParsing

# SQL Server
Get-Service -Name 'MSSQL*'

# Migration chưa áp dụng (khi backend đang chạy, thêm --configuration Release)
cd backend; dotnet ef migrations list --configuration Release   # dòng có "(Pending)" là chưa chạy
```

Admin có trang kiểm tra hệ thống: `GET /api/admin/system/health`, `POST /api/admin/system/health/check`
(Database, AIService, Email).

## 3. Tra theo thông báo trên giao diện

Frontend đổi lỗi HTTP thành câu tiếng Việt (`useErrorText` trong `pages/Auth.tsx`). Tra ngược như sau:

| Thấy trên giao diện | HTTP | Nguyên nhân thường gặp | Xem |
|---|---|---|---|
| "Không thể kết nối máy chủ…" | 0 | Backend tắt / sai `VITE_API_URL` / CORS | [5.1](#51-backend-không-khởi-động-hoặc-không-nhận-request) |
| "Máy chủ chưa có chức năng này…" | 404 `REQUEST_FAILED` | Backend đang chạy **bản cũ** chưa có endpoint mới | [12](#12-sau-khi-pull-hoặc-merge) |
| "Hệ thống đang gặp sự cố…" | 500 | Exception chưa bắt → đọc log backend | [5.2](#52-lỗi-500) |
| Câu tiếng Việt cụ thể (vd "Danh mục không tồn tại.") | 400 / 404 / 409 | Lỗi nghiệp vụ, câu đó là `detail` từ backend | [5.3](#53-lỗi-nghiệp-vụ-400--404--409) |
| "Bạn thử quá nhiều lần…" / "Bạn đã dùng hết N tin nhắn AI hôm nay…" | 429 | Rate limit, hoặc hết hạn mức tin nhắn AI | [7.3](#73-429-và-409-khi-chat) |
| Chat: "Dịch vụ AI tạm thời không khả dụng" | 503 | ai-service tắt, hoặc mọi model Gemini đều lỗi | [7.1](#71-chat-báo-503) |
| Trang chat báo `Invalid column name …` | 500 | Thiếu migration | [4.2](#42-thiếu-migration) |
| Bị đá về trang đăng nhập liên tục | 401 | Token hết hạn và refresh lỗi, hoặc đổi `Jwt__Key` | [6](#6-đăng-nhập-và-phân-quyền) |

## 4. Database và migration

### 4.1 Không kết nối được SQL Server

**Triệu chứng:** `A network-related or instance-specific error…`, `The wait operation timed out`, `error: 258`,
`/api/health` trả 503, `dotnet ef` báo *Unable to determine which migrations have been applied*.

**Sửa:**
1. `Get-Service MSSQL*`. Dịch vụ dừng thì bật lại (SQL Server Configuration Manager hoặc `Start-Service`).
2. Kiểm tra `ConnectionStrings__DefaultConnection` trong `backend/.env` (tên instance, `TrustServerCertificate=True` khi dev).
3. Instance có tên (`.\SQLEXPRESS`) cần dịch vụ **SQL Server Browser** chạy, hoặc ghi rõ cổng.

### 4.2 Thiếu migration

Lỗi `Invalid column name …` hoặc `Invalid object name …`: code đã có model mới nhưng database chưa có migration. Lỗi hay hiện ở chỗ **khác hẳn** chỗ vừa sửa (ví dụ cột
`AIConversations.Kind` làm hỏng trang chat).

```powershell
cd backend
dotnet ef migrations list --configuration Release   # tìm dòng (Pending)
dotnet ef database update --configuration Release
```

### 4.3 Tạo migration bị rỗng hoặc lỗi

| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| Migration mới không có `AddColumn`… | Build cũ, model chưa được biên dịch lại | Xóa migration rỗng, build rồi tạo lại. Không dùng `--no-build` ngay sau khi sửa model |
| `The process cannot access the file … backend.exe` | Backend đang chạy giữ file exe | Thêm `--configuration Release`, hoặc dừng backend |
| `No project was found` | Đứng sai thư mục | Chạy trong `backend/` |
| Migration có `DropColumn` / `DropTable` không mong muốn | Model bị xóa nhầm hoặc snapshot lệch sau merge | **Không áp dụng**. Mở file kiểm tra, đối chiếu `AppDbContextModelSnapshot.cs` |

Luôn mở migration vừa tạo để đọc trước khi `database update`. Migration có xóa dữ liệu phải hỏi chủ dự án.

### 4.4 Dữ liệu chat không giải mã được

**Triệu chứng:** lịch sử chat, tiêu đề hội thoại hoặc thẻ thao tác AI lỗi khi tải (`CryptographicException`,
`The computed authentication tag did not match`).

**Nguyên nhân:** `Encryption__MasterKey` trong `backend/.env` đã bị đổi (hoặc dùng `.env` của máy khác với cùng DB).
**Không có cách lấy lại** dữ liệu đã mã hóa bằng khóa cũ. Đặt lại khóa cũ. Nếu mất hẳn thì phải xóa dữ liệu chat của DB đó.

## 5. Backend

### 5.1 Backend không khởi động hoặc không nhận request

| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| `Failed to bind to address … address already in use` | Tiến trình cũ giữ cổng 5146 | Lệnh ở [mục 2](#2-kiểm-tra-nhanh-1-phút); chỉ dừng khi chắc đó là bản cũ của dự án |
| `… is not configured` / exception khi khởi động về `Jwt`, `Encryption`, `ConnectionStrings` | Thiếu khóa trong `backend/.env` | So với `backend/.env.example` |
| `The framework 'Microsoft.NETCore.App', version '10…' was not found` | Thiếu .NET 10 SDK | `dotnet --list-sdks` |
| Trình duyệt báo CORS | Frontend chạy ở origin chưa khai báo | Dev dùng proxy Vite (`/api` → 5146), để `VITE_API_URL` trống. Origin khác thì thêm vào `Cors:AllowedOrigins` (trong `.env`: `Cors__AllowedOrigins__0=http://...`) |
| Request tới `/api/...` trả HTML của frontend | Gọi nhầm cổng frontend mà proxy không bật | Kiểm tra `vite.config.ts` proxy và `VITE_API_URL` |

### 5.2 Lỗi 500

Trình duyệt chỉ thấy `An unexpected error occurred.`; nguyên nhân thật nằm ở log backend.

| Log / triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| `InvalidOperationException` khi binding, **mọi request** của một endpoint đều 500 | Record DTO dùng `[property: Required]` | Đặt attribute lên **tham số** (`[Required] string Name`). Test `DtoValidationTests.RequestRecordsKeepValidationOnConstructorParameters` bắt lỗi này |
| `DbUpdateException` / `SqlException 2627, 2601` | Vi phạm unique index | Kiểm tra trùng trước khi lưu và ném `ConflictException` |
| `DbUpdateConcurrencyException` | Bản ghi đã bị xóa/sửa ở request khác | Đọc lại rồi thử lại, hoặc trả 409 |
| `NullReferenceException` trong service | Dữ liệu tùy chọn (`CategoryName`, `AccountId`…) bị null | Kiểm tra null, ném `BadRequestException` có thông báo |
| `InvalidOperationException: The configured execution strategy … does not support user-initiated transactions` | Đã bật `EnableRetryOnFailure` mà code mở transaction thủ công (`BudgetService.CreateManyAsync`) | Bọc bằng `db.Database.CreateExecutionStrategy().ExecuteAsync(...)` |

Quy tắc: lỗi người dùng gây ra phải là `AppException` (400/404/409/429/503, `Helpers/AppExceptions.cs`) với câu tiếng
Việt, không để rơi xuống 500.

### 5.3 Lỗi nghiệp vụ (400 / 404 / 409)

Câu trong `detail` là câu do service ném ra; tìm câu đó trong `backend/Services` để thấy điều kiện.

- **404 với dữ liệu "có tồn tại":** mọi truy vấn lọc theo `UserId`, nên bản ghi của user khác luôn là 404. Kiểm tra
  đúng tài khoản đang đăng nhập.
- **409 ngân sách:** "Đã có ngân sách cho danh mục này trong khoảng thời gian đó." Một danh mục không được có hai
  ngân sách chồng ngày. Sửa ngân sách cũ thay vì tạo mới.
- **Xóa tài khoản không xóa:** tài khoản còn giao dịch hoặc khoản góp quỹ chỉ được **lưu trữ** (cố ý).
- **Xóa danh mục không xóa:** danh mục đang được dùng chỉ bị **tắt** (`IsActive = false`), không biến mất khỏi giao dịch cũ.

### 5.4 Dữ liệu đã đổi nhưng AI vẫn trả lời theo số cũ

Ngữ cảnh tài chính gửi AI được cache 60 giây (`FinancialContextCache`). `SaveChanges` tự xóa cache
(`FinancialDataChangeInterceptor`), nhưng **`ExecuteUpdate` / `ExecuteDelete` thì không**. Sau các lệnh đó phải gọi
`contextCache.Invalidate(userId)`.

## 6. Đăng nhập và phân quyền

| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| Mọi user bị đăng xuất sau khi khởi động lại backend | `Jwt__Key` đã đổi | Giữ cố định khóa trong `.env` |
| 429 khi đăng nhập | Rate limit `auth`: 10 request/phút | Chờ 1 phút; đừng viết script đăng nhập lặp |
| Không thấy nút Google | `VITE_GOOGLE_CLIENT_ID` trống (nút cố ý ẩn) | Điền trong `frontend/.env.local`, cùng giá trị `Google__ClientId` của backend |
| Google báo `origin_mismatch` / không có popup | Origin chưa khai trong Google Cloud | Thêm `http://localhost:5173` (và `:4173` nếu dùng preview) vào Authorized JavaScript origins |
| 403 ở `/api/admin/...` | Tài khoản không có vai trò Admin | Đăng nhập admin seed (`Seed__AdminEmail`) |
| Admin vào trang cá nhân bị chuyển về `/admin` | Cố ý: admin chỉ dùng khu `/admin` | Dùng tài khoản user thường |

## 7. Trợ lý AI

Luồng: trình duyệt → `POST /api/ai/chat/messages/stream` (backend: JWT, hạn mức, mã hóa, ngữ cảnh) → ai-service
`/v1/chat/stream` (`X-Service-Key`) → Gemini. Stream là **NDJSON**: mỗi dòng một JSON `start` / `delta` / `done` / `error`.

### 7.1 Chat báo 503

Kiểm tra theo thứ tự:
1. **ai-service có chạy không** (cổng 8001). Đây là nguyên nhân phổ biến nhất.
2. **Service key khớp không:** `AIService__ServiceKey` (backend) phải bằng `SERVICE_KEY` (ai-service). Lệch thì
   ai-service trả 401 và log backend có lỗi khi gọi `v1/chat/stream`.
3. **Gemini:** xem console ai-service.

| Log ai-service | Ý nghĩa | Sửa |
|---|---|---|
| `Model X failed (unavailable / quota …). Skipping it for Ns.` rồi `Answering with fallback model …` | Model chính quá tải hoặc hết quota, đã chuyển model dự phòng | Bình thường. Nếu lặp mãi, thêm model vào `GEMINI_FALLBACK_MODELS` |
| Mọi model đều failed | Hết quota cả key, hoặc mạng | Chờ hoặc đổi `GEMINI_API_KEY` |
| 400 `Thinking level is not supported` / `thinking_budget` | Sai kiểu thinking cho họ model | `tools.py` → `thinking_for`: `gemini-2.5*` dùng `thinking_budget=0`, `gemini-3*` dùng `thinking_level="minimal"` |
| 400 / 401 / 403 `API key not valid` | Key sai: **không** chuyển model dự phòng | Sửa `GEMINI_API_KEY` |
| 404 model | Tên model sai hoặc đã ngừng | Thử model với key thật trước khi thêm vào danh sách |

### 7.2 422 từ ai-service

`ChatRequest` giới hạn: `message` 1–4000 ký tự, `history` tối đa 30 lượt (mỗi lượt ≤ 8000), `financial_context`
≤ 30.000 ký tự (`ai-service/app/schemas.py`). Thêm dữ liệu vào `BuildContextAsync` mà vượt 30.000 ký tự thì mọi tin
nhắn đều lỗi. Giữ ngữ cảnh gọn: số nguyên VND, không id, không null (`CompactJson`).

### 7.3 429 và 409 khi chat

| Mã | Nguyên nhân | Sửa |
|---|---|---|
| 429 "Bạn đã dùng hết N tin nhắn AI hôm nay…" | Hết hạn mức tin nhắn ngày (đếm `AIProcessingLogs` có `TaskType = "Chat"`, `Status = Completed` từ 00:00 theo múi giờ user) | Admin tăng hạn mức (10 / 20 / 50 / không giới hạn), hoặc chờ qua ngày |
| 429 ngay sau nhiều request | Rate limit `ai`: 20 request/phút | Chờ 1 phút |
| 409 | Mỗi user chỉ chạy **một** yêu cầu AI cùng lúc (`UserRequestGate`) | Chờ câu trả lời trước xong; kiểm tra frontend không gửi 2 lần |

Nhập nhanh (`mode: "capture"`) cũng tính vào hạn mức.

### 7.4 Câu trả lời sai hoặc lạ

| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| Trả lời hết một lúc thay vì chạy từng chữ | Proxy bật buffer (nginx, IIS…) | Tắt buffer cho `/api` (`X-Accel-Buffering: no` đã gửi sẵn); xem [mục 13](#13-docker-và-deploy) |
| Hiện chữ `[[intent:…]]` | `IntentTagFilter` bị bỏ qua | Text phải đi qua filter trong `gemini_service.py` |
| AI bịa số liệu | Dữ liệu không có trong ngữ cảnh | Thêm dữ liệu vào `BuildContextAsync` (không mô tả giao dịch, không email/id user), sửa phần mô tả trong `SYSTEM_INSTRUCTION` |
| AI nói "đã lưu" | Prompt bị sửa sai | Quy tắc "không bao giờ nói là đã lưu" trong `SYSTEM_INSTRUCTION` phải còn |
| Không thấy hội thoại Nhập nhanh trong lịch sử | Cố ý: `Kind = QuickEntry` bị ẩn | Truy vấn danh sách chat phải lọc `Kind == Chat` |
| Tiếng Việt in ra console Python lỗi `UnicodeEncodeError` | Console Windows | `$env:PYTHONIOENCODING='utf-8'` |

## 8. Thao tác AI và đề xuất ngân sách

AI chỉ **đề xuất**; mỗi thao tác lưu ở bảng `AIActions` (payload mã hóa), user bấm xác nhận thì backend mới thực hiện.

### 8.1 AI trả lời bằng chữ thay vì hiện thẻ

1. Tên hàm có trong cả `tools.py` (`ACTION_NAMES`) **và** `AIActionTypes.All` (`backend/DTOs/AIActions.cs`) không?
   Thiếu một bên thì thao tác bị **bỏ im lặng**. Test `test_intent_filter_and_tools.py` đối chiếu hai bên.
2. Prompt có yêu cầu rõ gọi hàm không? Với đề xuất ngân sách, model từng tự liệt kê bằng chữ: quy tắc "BẮT BUỘC gọi
   `propose_budgets`, không liệt kê bằng văn bản" trong `SYSTEM_INSTRUCTION` phải còn.
3. Chế độ Nhập nhanh chỉ có `CAPTURE_TOOLS` (giao dịch, danh mục, tài khoản), nên không có ngân sách ở đó.

### 8.2 Thẻ hiện nhưng thiếu danh mục / tài khoản

Backend khớp **tên** của AI với dữ liệu user (`Match`: đúng tên, rồi bỏ dấu). Không khớp thì id để `null` và thẻ mở
sẵn ô chọn. Nếu luôn không khớp: tên trong ngữ cảnh (`expenseCategories`, `incomeCategories`, `accounts`) có khớp tên
thật không, danh mục có đang `IsActive` không.

AI tạo danh mục "Vietcombank": ngân hàng/ví là **tài khoản**; `ProposeAsync` đã bỏ `create_category` trùng tên tài khoản.

### 8.3 Xác nhận thao tác bị lỗi

| Mã | Ý nghĩa | Ghi chú |
|---|---|---|
| 400 | Dữ liệu trên thẻ chưa hợp lệ | Thẻ vẫn ở trạng thái chờ; sửa rồi xác nhận lại |
| 409 "Thao tác này đã được xử lý." | Đã xác nhận / hủy trước đó (bấm 2 lần, 2 tab) | Đúng thiết kế: không bao giờ chạy 2 lần |
| 404 | Thao tác của user khác hoặc đã bị xóa cùng hội thoại | |

Nếu thực hiện thất bại, `ConfirmAsync` trả thao tác về `Pending` để user thử lại.

### 8.4 Đề xuất ngân sách (`propose_budgets`)

| Triệu chứng | Nguyên nhân |
|---|---|
| AI nói chưa đủ dữ liệu | `expenseHistory` trống: chưa có chi tiêu trong 3 tháng gần nhất. Đúng thiết kế |
| Câu "Mình chưa lập được đề xuất ngân sách…" | Backend đã bỏ hết các mục: tên không khớp, hoặc mọi danh mục đã có ngân sách chồng kỳ |
| Một danh mục AI nhắc tới không có trên thẻ | Đã có ngân sách trong kỳ; tên nằm ở dòng "Đã có ngân sách trong kỳ nên không đưa vào" (`skippedCategories`) |
| 409 khi bấm "Xác nhận tạo" | Có ngân sách mới được tạo cho danh mục đó sau khi AI đề xuất. Toàn bộ bị rollback; bỏ chọn danh mục đó rồi tạo lại |
| Tạo xong nhưng trang Ngân sách không thấy | Ngân sách cho **tháng sau**: trang chỉ hiện kỳ đang chọn, nên sẽ thấy khi tháng đó bắt đầu |
| "TB … /tháng" khác số AI viết | Số trung bình do **backend** tính từ DB, AI không được tự tính. Tin số trên thẻ |

`POST /api/budgets/bulk` và nút xác nhận đều dùng `BudgetService.CreateManyAsync`: một transaction Serializable,
lỗi một mục là không lưu mục nào, không bao giờ ghi đè ngân sách cũ.

## 9. Frontend

### 9.1 Build hỏng (`npm run build` = `tsc --noEmit && vite build`)

| Lỗi | Nguyên nhân | Sửa |
|---|---|---|
| `TS1117: An object literal cannot have multiple properties with the same name` trong `vi.ts` | Khóa dịch trùng | Tìm khóa trước khi thêm; giữ một bản |
| Lỗi kiểu trong file `*.test.ts(x)` | File test cũng được `tsc` kiểm tra | Sửa test cùng lúc với code |
| `Property 'x' does not exist on type 'AIActionPayload'` | `services/types.ts` lệch DTO backend | Thêm trường khớp với C# (camelCase) |
| `Type '"new_type"' is not assignable to type 'AIActionType'` | Thêm loại thao tác mà quên union type | Thêm vào `AIActionType` và `meta` trong `AIActionCard.tsx` |

### 9.2 Giao diện sai

| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| Chữ "biến mất" (cùng màu nền) | Dùng `text-base`: ở dự án này đó là **màu nền** (`--color-base`) | Dùng `text-[1rem]` |
| Màu sai ở chế độ sáng/tối | Ghi cứng mã hex hoặc màu Tailwind (`text-amber-500`) | Dùng biến trong `index.css` (`ink`, `muted`, `alert`, `caution`…) |
| Thu/chi không còn xanh/đỏ, hoặc cảnh báo bị đỏ | Dùng sai token | `positive` / `negative` chỉ cho thu/chi; mức độ dùng `alert` / `caution` |
| Hiện tiếng Anh giữa giao diện Việt | Thiếu khóa trong `vi.ts` | Thêm bản dịch (`vi.test.ts` kiểm tra placeholder `{name}` hai bản khớp nhau) |
| Số tiền hiện sai định dạng / không ẩn khi bật ẩn số dư | Tự format bằng `Intl` / `toLocaleString` | Dùng `money` / `compact` / `percent` trong `lib/currency.ts` |
| Dialog bị mờ/đè trong thẻ | Tự dựng `position: fixed` trong phần tử có `transform` | Dùng `Modal` (portal ra `body`) |
| Trang khác không cập nhật sau thao tác AI | Thiếu sự kiện | Phát `window` event `FINANCE_CHANGED_EVENT` (`mm-finance-changed`) |
| Gõ `.5` ở USD ra `5.` | Lỗi đã biết của `AmountInput` | Có `it.fails` trong `AmountInput.test.tsx`; sửa xong thì đổi thành `it` |

### 9.3 Chậm hoặc bundle phình

Đo bằng `npm run build` + `npx vite preview` (cổng 4173), **không** đo trên dev server. Nguyên nhân thường gặp:

- Import tĩnh `recharts`, `gsap`, hoặc import từ `pages/Overview` ở trang khác → kéo hàng trăm KB vào bundle đầu.
- Viết `<motion.div>` thay vì `<m.div>` (framer-motion phải đi qua `LazyMotion`).
- Trang mới không dùng `React.lazy` trong `App.tsx`.
- Trang nằm sau trang AI dùng `useAmbientAI()` thay vì `useAmbientAIView()` → render lại khi mở/đóng AI.

So kích thước chunk trong output của `vite build` trước và sau thay đổi.

## 10. Số liệu tài chính sai

| Triệu chứng | Nguyên nhân | Chỗ cần đồng bộ |
|---|---|---|
| Số dư tài khoản lệch giữa các trang | Quên trừ tiền đã góp quỹ | `AccountService`, `FinancialAnalysisService`, `FinancialGoalService.AvailableBalanceAsync`, `useWorkspaceData` |
| Báo cáo chi tiêu tăng sau khi góp quỹ | Góp quỹ tạo giao dịch chi | Góp quỹ **không** được tạo giao dịch |
| Giao dịch lệch sang ngày hôm trước/sau | Lưu ngày ở 00:00 thay vì 12:00 UTC | Ngày-không-giờ lưu `12:00 UTC` (backend và frontend) |
| Ngân sách "đã chi" khác trang Ngân sách | Kỳ khác nhau | `BudgetService.GetSpentAsync` dùng `[StartDate, EndDate + 1 ngày)`; trang Ngân sách theo kỳ đang chọn |
| "Hôm nay" sai ngày | Dùng giờ UTC thay vì múi giờ user | `FinancialAnalysisService.LocalToday(user.TimeZoneId)` |
| Hai ví mặc định / tài khoản trùng tên | Bảng `Accounts` chưa có unique index (UserId, Name); hai request song song | Đã biết, chưa sửa ở backend |

## 11. Test và CI

```powershell
cd backend.Tests; dotnet test --nologo
cd ai-service;    .\.venv\Scripts\python -m unittest discover -s tests
cd frontend;      npm.cmd test          # hoặc: node node_modules\vitest\vitest.mjs run
cd frontend;      npm run build
```

Chạy một test: `dotnet test --filter "FullyQualifiedName~BulkBudgetTests"`,
`python -m unittest tests.test_model_fallback -v`, `node node_modules\vitest\vitest.mjs run src/pages/Auth.test.tsx`.

| Lỗi | Nguyên nhân | Sửa |
|---|---|---|
| Backend test không biên dịch sau khi thêm hàm vào interface | Fake viết tay chưa có hàm mới (`TestSupport.cs`: `FakeBudgetService`, `FakeActions`, `FakeAnalysis`…) | Thêm hàm vào fake |
| `TheApiHasTheExpectedNumberOfControllers` | Thêm/bớt controller | Cập nhật con số; endpoint mới phải có `[Authorize]` hoặc `[AllowAnonymous]` có chủ đích |
| Test đọc lại bản ghi vẫn thấy giá trị cũ sau `ExecuteUpdate` | DbContext trả bản đang theo dõi (tracked) | `Db.ChangeTracker.Clear()` trước khi đọc |
| Muốn dùng EF InMemory | `ExecuteUpdate`/`ExecuteDelete` cần provider quan hệ | Dùng SQLite in-memory như `DbTestBase` |
| So sánh decimal lệch | SQLite lưu decimal dạng double | Dùng giá trị tròn hoặc so có sai số |
| ai-service `test_action_names` / `test_arguments_the_backend_reads_are_declared` | Thêm tool mà chưa cập nhật danh sách trong test | Cập nhật cả test lẫn `AIActions.cs` |
| Test chỉ lỗi trên máy có `frontend/.env.local` (từng gặp: `does not show the Google button…`) | Code đọc `import.meta.env.*` lúc import, nên giá trị trong `.env.local` của dev lọt vào test | Test phải tự cố định giá trị: `vi.mock` module đọc biến đó (xem đầu `Auth.test.tsx`) |
| `Cannot find package 'jsdom'` / `Failed to start forks worker`, đường dẫn có `npm-cache\_npx` | Chạy `npx vitest` ngoài thư mục `frontend`, nên npx tải một bản Vitest khác không có jsdom | Chạy trong `frontend`: `npm.cmd test` hoặc `npx vitest run <file>` |
| `npm test` bị chặn "running scripts is disabled" | Execution policy PowerShell | `npm.cmd test` |
| Test component lỗi `document is not defined` | Thiếu môi trường DOM | Docblock `// @vitest-environment jsdom` đầu file, render qua `src/test/dom.tsx` |
| CI đỏ, máy xanh | Thiếu `npm ci` / lock lệch / `.env` cục bộ che lỗi | Chạy đúng 4 lệnh trên; commit `package-lock.json` |
| Test UI lúc qua lúc lỗi, CI hay lỗi hơn (ví dụ `DropdownMenu` "closes when Tab moves on") | Test bấm phím / kiểm tra ngay, trong khi component làm việc đó ở frame sau (`requestAnimationFrame`, `setTimeout`) | Chờ trạng thái trước khi thao tác: `await waitFor(() => expect(item).toHaveFocus())`. Tái hiện trên máy bằng cách làm `requestAnimationFrame` chậm lại (`setTimeout(cb, 80)`) |
| Annotation CI chỉ báo dòng không khớp file trên máy | Xem nhầm dòng của test khác | Đọc tên test trong annotation (`file > describe > it`), không chỉ số dòng |

## 12. Sau khi pull hoặc merge

Làm đủ các bước, theo thứ tự:

```powershell
git status                                   # còn "both modified" / "Unmerged" thì chưa xong
git diff --name-only --diff-filter=U         # file còn xung đột
git grep -n -E '^(<<<<<<<|>>>>>>>) '         # dấu xung đột sót lại

cd backend; dotnet ef database update --configuration Release   # migration mới của người khác
cd frontend; npm ci --legacy-peer-deps                          # dependency mới (dừng dev server trước, nếu không sẽ EPERM)
# Dừng và chạy lại backend + ai-service: tiến trình đang chạy vẫn là code cũ
# Rồi chạy đủ 4 lệnh ở mục 11
```

**Xung đột "im lặng":** Git tự gộp được nhưng code vẫn sai. Những chỗ đã từng xảy ra:

- Một bên đổi chữ ký hàm (ví dụ `ExecuteAsync` trả `(Guid, payload)`), bên kia thêm nhánh mới theo chữ ký cũ → lỗi biên dịch
  ở dòng Git không đánh dấu.
- Một bên thêm hàm vào interface, bên kia thêm fake trong test → test không biên dịch.
- Hai bên cùng thêm loại thao tác AI → phải gộp ở **cả** `tools.py`, `AIActions.cs`, `AIActionService`,
  `AIChatService.IntentFor`, `types.ts`, `AIActionCard.tsx`, test ai-service.
- Hai bên cùng đổi hình dạng ngữ cảnh AI (`BuildContextAsync`) và prompt (`SYSTEM_INSTRUCTION`) → hai file phải mô tả
  cùng tên trường.
- Hai bên cùng thêm khóa cuối `vi.ts` → kiểm tra trùng khóa (TS1117).

Trình duyệt báo "Máy chủ chưa có chức năng này" ngay sau khi pull = backend đang chạy bản cũ.

## 13. Docker và deploy

| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| Backend container lỗi `Invalid column name` | Service `migrate` chưa chạy / lỗi | `docker compose logs migrate`; backend không tự migrate |
| Chat 503 trong Docker | ai-service nghe `127.0.0.1` thay vì `0.0.0.0`, hoặc `SERVICE_KEY` lệch | Kiểm tra `.env` gốc và log `ai-service` |
| Câu trả lời AI không stream | Proxy chen giữa bật buffer | nginx của frontend đã tắt buffer cho `/api`; không đặt proxy khác bật buffer |
| Thông báo realtime không đến | `/hubs` (WebSocket) chưa được proxy | `frontend/nginx.conf` phải chuyển `/hubs` sang backend kèm header Upgrade |
| Deploy không chạy sau khi CI xanh | Biến repo `DEPLOY_ENABLED` chưa là `true` | Xem [deploy/README.md](./deploy/README.md) |
| Bí mật lộ trong image | Copy `.env` vào image | Chỉ dùng `.env` (git-ignore) hoặc biến môi trường nơi chạy |

## 14. Bẫy Windows / PowerShell

- **`Errno 10048` / exe bị khóa:** tiến trình cũ giữ cổng hoặc file. Tìm bằng `Get-NetTCPConnection -LocalPort <cổng>`;
  chỉ dừng khi chắc đó là bản cũ của dự án.
- **`npm ci` lỗi `EPERM … lightningcss…node`:** dev server Vite đang chạy giữ file. Dừng nó, hoặc dùng
  `npm install --legacy-peer-deps` (không xóa `node_modules`).
- **Không dùng `-replace` / regex PowerShell để sửa TSX:** từng làm hỏng `{t('` cả file. Dùng script Node thay chuỗi
  chính xác, kiểm tra mỗi chuỗi khớp đúng 1 lần.
- **Xuống dòng:** repo có cả CRLF và LF; giữ nguyên kiểu của từng file. Ghi file bằng UTF-8 không BOM.
- **Hashtable PowerShell không phân biệt hoa thường** (`Amount` và `amount` trùng khóa) khi dựng JSON thử API.
- **Mất output console** khi chạy Node/Python: ghi ra file (`cmd /c "node x.mjs > out.txt 2>&1"`) rồi đọc file.
- **Tạo file script và chạy nó trong cùng một lượt song song:** lệnh chạy có thể chạy trước khi file được ghi.
- **Từ khóa C# trong LINQ query:** biến tên `from` không dùng được bên trong `from … in … where …` (`from.AddMonths(1)` bị
  hiểu là mệnh đề `from` mới). Tính giá trị ra biến khác trước câu truy vấn.

## 15. Phòng lỗi khi thêm tính năng

| Thêm… | Phải sửa thêm |
|---|---|
| Cột / bảng | Migration + đọc kỹ trước khi áp dụng; thông báo team chạy `database update` |
| Endpoint | Kế thừa `UserControllerBase` / `AdminControllerBase`; lọc `UserId`; DTO có attribute trên tham số; thử qua Swagger; test |
| Controller | Cập nhật số trong `ApiSecurityContractTests` |
| Hàm trong interface | Fake trong `backend.Tests/TestSupport.cs` |
| Loại thao tác AI | `tools.py`, `AIActions.cs`, `AIActionService` (`Normalize`, `Resolve`, `ExecuteAsync`), `AIChatService.IntentFor`, `types.ts`, `AIActionCard.tsx`, `SYSTEM_INSTRUCTION`, test ai-service |
| Dữ liệu vào ngữ cảnh AI | Giữ dưới 30.000 ký tự, không mô tả giao dịch / email / id user; mô tả trường trong `SYSTEM_INSTRUCTION` |
| Chuỗi giao diện | `vi.ts` (không trùng khóa, placeholder khớp) |
| Trang | `React.lazy`, skeleton cùng kích thước, trạng thái rỗng và lỗi |
| Cấu hình / bí mật | `.env.example` tương ứng; không commit `.env` |
| Dependency | `npm install --legacy-peer-deps` và commit `package-lock.json` |

Sau khi thử với dữ liệu thật, **xóa dữ liệu thử**; user thử đặt email dạng `zz-...@example.com`.

## 16. Mẫu báo lỗi

```text
Hiện tượng:   <thấy gì, ở trang nào, với tài khoản nào (không ghi mật khẩu)>
Tái hiện:     <các bước>
Mong đợi:     <đáng ra phải thế nào>
Request lỗi:  <METHOD /api/...>  status <mã>  detail "<câu trong body>"
Log backend:  <dòng "Unhandled exception…" và vài dòng stack trace đầu>
Log ai-service (nếu là AI): <dòng liên quan>
Phiên bản:    <git log -1 --oneline>   Migration pending: <có/không>
Đã thử:       <những gì đã loại trừ>
```

Không dán `.env`, token, mật khẩu hay nội dung chat thật của người dùng vào báo lỗi.

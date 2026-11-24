# AGENTS.md — Hướng dẫn cho AI agent và thành viên mới

File này được Kiro nạp tự động vào **mọi** phiên làm việc (cũng được nhiều công cụ AI khác đọc). Hãy giữ nó ngắn:
chỉ ghi những điều dễ làm sai. Cách cài đặt và chạy chi tiết nằm ở [README.md](./README.md) và
[DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md); tài liệu AI service ở [ai-service/README.md](./ai-service/README.md).

## Dự án

Ứng dụng quản lý tài chính cá nhân, giao diện tiếng Việt, có trợ lý AI (Gemini).

| Phần | Thư mục | Công nghệ | Cổng dev |
|---|---|---|---|
| Frontend | `frontend/` | React 18, TypeScript, Vite, Tailwind 4 | 5173 (proxy `/api` → 5146) |
| Backend | `backend/` | ASP.NET Core 10, EF Core 10, SQL Server, SignalR | 5146 |
| AI service | `ai-service/` | Python 3.11, FastAPI, Google Gen AI SDK | 8001 (chỉ nội bộ) |

Luồng AI: trình duyệt → backend (JWT, hạn mức, mã hóa, ngữ cảnh tài chính) → ai-service (`X-Service-Key`) → Gemini.
Trình duyệt **không bao giờ** gọi ai-service hay Gemini. Khóa Gemini chỉ nằm trong `ai-service/.env`.

## Kiểm tra trước khi báo xong

```powershell
cd backend;    dotnet build                                  # phải 0 Error(s)
cd frontend;   pnpm build                                    # chạy tsc --noEmit rồi vite build
cd ai-service; .\.venv\Scripts\python -m unittest discover -s tests
```

Backend và frontend chưa có test project. Khi đổi API, hãy thử thật qua Swagger (`http://localhost:5146/swagger`)
hoặc script, và **xóa dữ liệu thử** sau đó (người dùng thử đặt email dạng `zz-...@example.com`).

## Quy ước backend

- **Tầng:** `Controllers/` → `Services/Interfaces` + `Services/Implementations` → `Data/AppDbContext`. DTO trong
  `DTOs/Requests`, `DTOs/Responses`. Đăng ký DI trong `Program.cs`.
- **Phân quyền:** controller người dùng kế thừa `UserControllerBase` (có `[Authorize]`, lấy `UserId`); controller admin
  kế thừa `AdminControllerBase` (`[Authorize(Roles = Admin)]`). Mọi truy vấn dữ liệu tài chính phải lọc theo `UserId`.
- **Route** viết cố định, kebab-case: `[Route("api/financial-goals")]`, admin dưới `api/admin/...`.
- **Lỗi:** ném `BadRequestException`, `NotFoundException`, `ConflictException`, `ForbiddenException`,
  `TooManyRequestsException`, `ServiceUnavailableException` (`Helpers/AppExceptions.cs`). Middleware đổi sang
  ProblemDetails. Thông báo cho người dùng viết **tiếng Việt**; comment code viết tiếng Anh.
- **JSON:** camelCase, enum dạng chuỗi (`"Expense"`). Thời gian lưu UTC; khi trả ra dùng `DateTimeKind.Utc` để có `Z`.
  Giao dịch chỉ có ngày được lưu lúc **12:00 UTC** của ngày đó (giống frontend).
- **Validation:** attribute trên record DTO chỉ chạy khi model binding. Service gọi service khác (ví dụ
  `AIActionService`) phải tự kiểm tra dữ liệu.
- **Bí mật:** đọc từ `backend/.env` (DotNetEnv, đã git-ignore). Thêm cấu hình mới thì cập nhật `.env.example`.
  **Không bao giờ đổi `Encryption__MasterKey`** khi đã có dữ liệu chat: dữ liệu cũ sẽ không giải mã được.

### Migration

```powershell
dotnet ef migrations add <Ten> -o Migrations
dotnet ef database update          # không dùng --no-build ngay sau khi vừa tạo migration
```

- Nếu backend đang chạy, file exe bị khóa: thêm `--configuration Release` hoặc dừng backend trước.
- Mở migration vừa tạo để kiểm tra trước khi áp dụng; migration rỗng nghĩa là build cũ chưa có thay đổi model.
- Sau khi `git pull`, chạy `dotnet ef database update`: thiếu migration gây lỗi `Invalid column name` ở chỗ khác hẳn.

## Dữ liệu nhạy cảm và AI

- Nội dung chat (`AIChatMessages`, tiêu đề hội thoại) và chi tiết thao tác AI (`AIActions`) được **mã hóa AES-GCM**
  bằng khóa riêng của từng user (`IEncryptionService`). Không lưu bản rõ, kể cả trong `localStorage` của frontend.
- Ngữ cảnh tài chính gửi cho Gemini (`FinancialAnalysisService.BuildContextAsync`) **không** chứa mô tả giao dịch,
  email hay id người dùng. Ngữ cảnh được cache 60 giây (`FinancialContextCache`) và bị xóa tự động khi
  `SaveChanges` đổi giao dịch, tài khoản, danh mục, ngân sách, quỹ (`FinancialDataChangeInterceptor`).
  **`ExecuteUpdate`/`ExecuteDelete` bỏ qua interceptor**: gọi `contextCache.Invalidate(userId)` ngay sau đó.
- **Hạn mức tin nhắn:** đếm bản ghi `AIProcessingLogs` có `TaskType = "Chat"` và `Status = Completed` từ 00:00 theo
  múi giờ của user. Admin cấp 10 / 20 / 50 / không giới hạn (-1).
- **Model:** do hệ thống chọn, không cho user chọn. Danh sách ưu tiên trong `ai-service/.env`
  (`GEMINI_MODEL_RESPOND`, `GEMINI_FALLBACK_MODELS`). Thử một model với key thật trước khi thêm vào danh sách.
- **Thinking theo họ model** (`ai-service/app/tools.py` → `thinking_for`): `gemini-2.5*` dùng `thinking_budget=0`,
  `gemini-3*` dùng `thinking_level="minimal"`. Dùng sai kiểu sẽ bị 400.

### Thao tác AI (AI đề xuất, user xác nhận)

AI không bao giờ tự lưu. Thêm một loại thao tác mới phải sửa **đủ 4 chỗ**:

1. `ai-service/app/tools.py`: khai báo hàm (tham số snake_case).
2. `backend/DTOs/AIActions.cs`: `AIActionTypes` và trường trong `AIActionPayload`.
3. `backend/Services/Implementations/AIActionService.cs`: `Normalize`, `Resolve`, `ExecuteAsync` (gọi service có sẵn).
4. `frontend/src/components/ambient-ai/AIActionCard.tsx`: tiêu đề, dòng tóm tắt, form sửa, `missing()`.

Hiện có 5 loại: thêm giao dịch, thêm danh mục, tạo ngân sách, tạo quỹ, góp quỹ. Chưa có sửa hay xóa.

**Nhập nhanh** (`QuickEntry.tsx` trên trang Tổng quan): `POST api/ai/chat/messages` với `mode: "capture"`. Tin nhắn
được lưu vào một hội thoại ẩn mỗi user (`AIConversation.Kind = QuickEntry`, không hiện trong danh sách chat, không gửi
lịch sử) và vẫn tính vào hạn mức tin nhắn. Truy vấn danh sách hội thoại chat phải lọc `Kind == Chat`.

## Quy ước frontend

- Gọi API qua `src/services/` (`http` axios + `getData`); kiểu trong `src/services/types.ts` khớp DTO backend.
  Streaming dùng `postStream` trong `client.ts` (axios không stream được trong trình duyệt).
- **i18n:** chuỗi trong code viết tiếng Anh `t('Save changes')`, bản dịch tiếng Việt trong `src/i18n/vi.ts`.
  **Khóa trùng trong `vi.ts` làm hỏng build (TS1117)**: tìm khóa trước khi thêm.
- Sau khi một thao tác ngoài trang hiện tại đổi dữ liệu, phát `window` event `mm-finance-changed`
  (`FINANCE_CHANGED_EVENT`) để App tải lại giao dịch, ngân sách, quỹ, thông báo.
- README dùng `pnpm`; repo có cả `package-lock.json`. Đừng tự đổi lock file khi không được yêu cầu.

## Bẫy trên Windows / PowerShell

- In tiếng Việt từ Python ra console: đặt `$env:PYTHONIOENCODING='utf-8'`, nếu không sẽ gặp `UnicodeEncodeError`.
- Hashtable PowerShell **không phân biệt hoa thường** (`'Amount'` và `'amount'` là trùng khóa).
- Ghi file bằng `[IO.File]::WriteAllText(..., UTF8 không BOM)`; giữ nguyên kiểu xuống dòng (repo có cả CRLF và LF).
- Lỗi `Errno 10048` / exe bị khóa: một tiến trình cũ đang giữ cổng. Kiểm tra `Get-NetTCPConnection -LocalPort <cổng>`
  và chỉ dừng tiến trình khi chắc nó là bản cũ của dự án.

## Cách làm việc theo phiên

- Chia việc lớn thành nhiều bước nhỏ, mỗi bước build hoặc test xong mới sang bước sau.
- Không chép nội dung README vào file này; cập nhật README khi đổi cách chạy hoặc kiến trúc.
- Khi context gần đầy, mở phiên mới và dán bản bàn giao ngắn:

```text
Mục tiêu: <việc đang làm>
Đã xong: <các bước + lệnh kiểm tra đã chạy>
Còn lại: <bước tiếp theo>
File liên quan: <đường dẫn>
Quyết định đã chốt: <ví dụ: AI phải chờ user xác nhận>
```

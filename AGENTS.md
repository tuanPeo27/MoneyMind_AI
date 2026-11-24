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

- **Số dư tài khoản** = `InitialBalance` + thu − chi − tiền đã góp quỹ từ tài khoản đó (`GoalContributions`).
  Góp quỹ **không** tạo giao dịch (để báo cáo chi tiêu không sai). Mọi chỗ tính số dư phải trừ phần góp quỹ:
  `AccountService`, `FinancialAnalysisService`, `FinancialGoalService.AvailableBalanceAsync`, frontend
  `useWorkspaceData`. Tài khoản còn giao dịch hoặc khoản góp quỹ thì chỉ được **lưu trữ**, không xóa.
- **Admin không được xem giao dịch từng người.** `/api/admin/transactions/stats` chỉ trả số liệu tổng hợp; danh mục do
  user tự tạo và danh mục có dưới 3 người dùng được gộp chung (`AdminTransactionService.MinGroupSize`). Đừng thêm
  endpoint admin đọc giao dịch chi tiết.
- **Tài khoản Admin chỉ dùng khu `/admin`**: frontend chuyển admin khỏi mọi trang cá nhân và không tải dữ liệu cá nhân.
- **Nhắc góp quỹ:** `GoalReminderService` (`BackgroundService`, chạy khi khởi động rồi mỗi 30 phút) tạo thông báo vào
  `ReminderDay` theo múi giờ của user; `LastReminderOn` chặn gửi trùng trong ngày. Ngày 29–31 dời về cuối tháng ngắn.
- **Số điện thoại:** `Helpers/PhoneNumberRules.cs` (`[ValidPhoneNumber]`, lưu dạng chuẩn `0901234567` / `+1650…`) và
  `frontend/src/lib/phone.ts` là **cùng một quy tắc**: sửa một bên thì sửa cả bên kia.

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

## Quy ước frontend

- Gọi API qua `src/services/` (`http` axios + `getData`); kiểu trong `src/services/types.ts` khớp DTO backend.
  Streaming dùng `postStream` trong `client.ts` (axios không stream được trong trình duyệt).
- **i18n:** chuỗi trong code viết tiếng Anh `t('Save changes')`, bản dịch tiếng Việt trong `src/i18n/vi.ts`.
  **Khóa trùng trong `vi.ts` làm hỏng build (TS1117)**: tìm khóa trước khi thêm.
- Sau khi một thao tác ngoài trang hiện tại đổi dữ liệu, phát `window` event `mm-finance-changed`
  (`FINANCE_CHANGED_EVENT`) để App tải lại giao dịch, ngân sách, quỹ, thông báo.
- README dùng `pnpm`; repo có cả `package-lock.json`. Đừng tự đổi lock file khi không được yêu cầu.
- **Tiền:** dữ liệu luôn là **VND**. Hiển thị chỉ qua `money` / `formatAmount` / `compact` / `percent` trong
  `src/lib/currency.ts` (tiếng Việt → VND, tiếng Anh → USD theo tỉ giá thật, cache 12 giờ, dự phòng 26.000).
  Các hàm này tự trả `••••••` khi user bật ẩn số dư (`setAmountsHidden` gọi trong `App.tsx`), nên **không** tự
  format tiền bằng `Intl`. Ô nhập tiền dùng `AmountInput` (chặn chữ, nhóm 3 số, gửi VND qua input ẩn).
- **Thành phần dùng chung:** ô chọn dùng `Select` / `FormSelect` (`components/Select.tsx`), menu dùng `DropdownMenu`,
  hộp thoại dùng `Modal` (portal ra `body`, `z-[90]`, nằm trên trang AI). Không dùng `<select>` gốc hay
  `window.confirm`.
- **Đang tải:** dùng skeleton (`components/Skeleton.tsx`: `Skeleton`, `SkeletonText`, `useFadeIn`, `PageSkeleton`), không
  dùng spinner. Skeleton phải cùng kích thước với nội dung thật (đo bằng CLS). Cờ tải lần đầu là `data.ready` /
  `savings.ready`; khi chưa sẵn sàng thì không hiện trạng thái rỗng ("Chưa có…").
- **Hiệu năng (đã tối ưu, đừng làm hỏng):**
  - Mọi trang là `React.lazy` trong `App.tsx`; trang mới cũng phải lazy. `App.tsx` không import từ `pages/Overview`
    (dùng `lib/totals`), nếu không chunk Overview và biểu đồ sẽ vào bundle đầu.
  - framer-motion chạy qua `<LazyMotion>`: viết `<m.div>`, **không** `<motion.div>` (kéo cả engine vào bundle đầu).
  - `recharts` chỉ import trong component lazy (`components/charts.tsx`, `admin/AdminCharts.tsx`); dữ liệu biểu đồ thuần
    nằm ở `lib/chartData.ts`.
  - Font Inter tự host (`@fontsource-variable/inter`), chỉ khai báo subset latin + vietnamese trong `index.css`, preload
    trong `index.html`. Logo giao diện là `public/logo-96.png` (`logo.png` 500 px chỉ là bản gốc).
  - Đo Lighthouse trên `pnpm build` + `npx vite preview` (cổng 4173), **không** trên dev server (dev cho kết quả sai rất xa).

## Bẫy trên Windows / PowerShell

- In tiếng Việt từ Python ra console: đặt `$env:PYTHONIOENCODING='utf-8'`, nếu không sẽ gặp `UnicodeEncodeError`.
- Hashtable PowerShell **không phân biệt hoa thường** (`'Amount'` và `'amount'` là trùng khóa).
- Ghi file bằng `[IO.File]::WriteAllText(..., UTF8 không BOM)`; giữ nguyên kiểu xuống dòng (repo có cả CRLF và LF).
- Không dùng `-replace` / regex PowerShell để sửa file TSX: chuỗi như `{t('` từng bị biến thành `name` làm hỏng cả
  file. Dùng script Node thay chuỗi chính xác và **kiểm tra mỗi chuỗi khớp đúng 1 lần** trước khi ghi.
- Tạo file script rồi chạy nó trong cùng một lượt gọi song song: lệnh chạy có thể chạy trước khi file được ghi.
- Chat báo 503 thường là **ai-service đang tắt** (cổng 8001), không phải lỗi code. Cần chạy cả 3 phần.
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

## Trạng thái gần nhất (cập nhật 24/11/2026)

Đã xong và đã kiểm tra (build + thử trên trình duyệt): trang Tài khoản; góp quỹ lấy tiền từ tài khoản và nhắc góp quỹ
hằng tháng (migration `AddGoalContributionsAndReminders`); thống kê giao dịch tổng hợp và quản lý danh mục mặc định cho
admin; ẩn toàn bộ số tiền; quy đổi VND/USD; validate số điện thoại; đăng nhập Google; tối ưu hiệu năng (Tổng quan
Lighthouse 70 → 94, đăng nhập 88 → 98).

Còn mở:
- **Xác minh khi đổi email / số điện thoại:** chưa làm, đang chờ chốt: gửi SMS bằng gì (đề xuất in mã ra log khi dev),
  có hỏi mật khẩu trước khi đổi email không, và cho thêm migration bảng `ContactVerifications`.
- Bảng `Accounts` chưa có unique index (UserId, Name) cho tài khoản chưa lưu trữ: hai request song song có thể tạo trùng.
  Frontend đã chặn việc tạo ví mặc định hai lần, backend thì chưa.
- Google Sign-In chưa nhận origin `http://localhost:4173` (bản preview); cần thêm trong Google Cloud nếu muốn dùng.
- Dữ liệu thử cũ còn trong DB local: các user `*@example.com` như `goaltest…`, `hide…`, `phone…`, `accounts…`,
  `taskbar…`, `statsuser…` (tạo trước khi có quy ước `zz-`). Xóa nếu cần DB sạch.

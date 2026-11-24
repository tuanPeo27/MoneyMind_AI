# Triển khai (CD)

Luồng: push vào `main` → CI xanh → workflow `Deploy` build 4 image, đẩy lên GHCR (`ghcr.io/<owner>/moneymind-*`)
→ SSH vào máy chủ → `docker compose pull` + `up -d` (service `migrate` chạy trước backend).

Workflow không làm gì cho đến khi bạn bật biến `DEPLOY_ENABLED=true`, nên chưa có máy chủ thì CI vẫn xanh.

## Chuẩn bị (làm một lần)

1. **Database miễn phí:** tạo Azure SQL Database bằng [free offer](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-tier?tabs=azure-portal&view=azuresql)
   (chọn "Apply free offer", bật tự dừng khi hết hạn mức). Mở firewall cho IP của máy chủ. Lấy connection string.
2. **Máy chủ Linux** (Oracle Cloud Always Free, AWS EC2, hoặc VPS bất kỳ) có Docker và Docker Compose plugin.
   Mở cổng 80 và 443. Trỏ tên miền (hoặc DuckDNS) về IP máy chủ. Image hiện build cho `linux/amd64`,
   nên chọn máy x86 (Oracle ARM cần sửa Dockerfile, xem bên dưới).
3. **Trên máy chủ:**
   ```bash
   mkdir -p ~/moneymind && cd ~/moneymind
   # tạo .env từ deploy/.env.example, điền giá trị thật
   nano .env
   ```
4. **Trên GitHub** (Settings → Secrets and variables → Actions):
   - Secrets: `SSH_HOST`, `SSH_USER`, `SSH_KEY` (private key, dạng PEM/OpenSSH), tùy chọn `SSH_PORT`.
   - Variables: `DEPLOY_ENABLED=true`, tùy chọn `DEPLOY_PATH` (mặc định `~/moneymind`), `GOOGLE_CLIENT_ID`.
   - Settings → Environments → tạo `production` (có thể bật "Required reviewers" nếu muốn duyệt tay trước khi deploy).
5. Chạy `Deploy` bằng tay (Actions → Deploy → Run workflow) để thử lần đầu.

## Lưu ý

- Bí mật chỉ nằm trong `.env` trên máy chủ và Secrets của GitHub, không nằm trong image hay repo.
- Không đổi `ENCRYPTION_MASTER_KEY` sau khi đã có dữ liệu chat.
- Rollback: trên máy chủ chạy `IMAGE_PREFIX=... IMAGE_TAG=<sha cũ> docker compose -f docker-compose.prod.yml --env-file .env up -d`.
- Oracle ARM (Ampere): đổi `-r linux-x64` trong target `migrate` của `backend/Dockerfile` thành `linux-arm64`
  và build image với `platforms: linux/arm64`.
- Tên package GHCR mặc định là private. Máy chủ đăng nhập GHCR bằng token của workflow trong lúc deploy, không cần lưu lại.

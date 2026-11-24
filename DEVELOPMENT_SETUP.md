# MoneyMind AI - Development Setup

This guide explains how to configure and run MoneyMind AI locally on Windows.

The application consists of three processes:

1. React frontend on Vite
2. ASP.NET Core backend
3. Python FastAPI AI service

SQL Server is required for application data.

## 1. Prerequisites

Install the following tools:

| Tool | Recommended version | Verification |
|---|---|---|
| .NET SDK | 10.0 or later | `dotnet --version` |
| SQL Server | 2019+ or SQL Server Express | SQL Server Configuration Manager / SSMS |
| Node.js | 20 or later | `node --version` |
| pnpm | 9+ | `pnpm --version` |
| Python | 3.11+ | `python --version` |
| Git | Current | `git --version` |
| Entity Framework CLI | 10.0.0 | `dotnet ef --version` |

SQL Server Management Studio is optional but useful for inspecting and managing the database.

## 2. Clone the repository

```powershell
git clone https://github.com/tuanPeo27/MoneyMind_AI.git
cd MoneyMind_AI
```

## 3. Local configuration

Create the ignored local configuration files:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item ai-service/.env.example ai-service/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Do not commit these files or place real credentials in `.env.example`.

### 3.1 Backend secrets

Open `backend/.env` and configure at least:

```dotenv
ConnectionStrings__DefaultConnection="Server=localhost;Database=MoneyMindAI;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"

Jwt__Key="<at least 32 random characters>"
Encryption__MasterKey="<base64-encoded 32-byte key>"
AIService__ServiceKey="<at least 32 random characters>"
```

For SQL Server Express, use an instance such as:

```dotenv
ConnectionStrings__DefaultConnection="Server=localhost\SQLEXPRESS;Database=MoneyMindAI;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
```

Generate an encryption key with PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Generate a 32-byte hex secret for JWT or AI service authentication:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### 3.2 Optional backend configuration

The backend `.env.example` also contains:

```dotenv
Seed__AdminEmail="admin@example.com"
Seed__AdminPassword="<strong password>"
Seed__AdminFullName="System Admin"

Google__ClientId="<Google OAuth Web client ID>"

Smtp__Host=""
Smtp__Port=587
Smtp__EnableSsl=true
Smtp__Username=""
Smtp__Password=""
Smtp__FromAddress=""
Smtp__FromName="MoneyMind AI"

Cors__AllowedOrigins__0=http://localhost:5173
Cors__AllowedOrigins__1=http://localhost:3000
```

Optional behavior:

- If seed admin email and password are configured, the seeder creates the account at startup.
- Leave `Smtp__Host` empty to log password-reset links instead of sending email.
- Configure Google only if Google sign-in is needed.
- `Cors__AllowedOrigins` is mainly for direct frontend origins. The Vite proxy handles the default
  local setup.

The backend configuration validates required keys at startup. Missing values will prevent startup.

### 3.3 AI service configuration

Open `ai-service/.env`:

```dotenv
GEMINI_API_KEY="<Google Gemini API key>"
GEMINI_MODEL_RESPOND="gemini-2.5-flash"
GEMINI_FALLBACK_MODELS="gemini-3.5-flash-lite,gemini-3.1-flash-lite"
SERVICE_KEY="<same value as AIService__ServiceKey>"
HOST="127.0.0.1"
PORT=8001
REQUEST_TIMEOUT_SECONDS=45
ATTEMPT_TIMEOUT_SECONDS=25
MAX_OUTPUT_TOKENS=2048
```

The Gemini models in the example must be available to the configured API key. Model names and
availability can change, so verify a model before adding it to the fallback list.

### 3.4 Frontend configuration

The default setup does not require a value for `VITE_API_URL` because Vite proxies `/api` to
`http://localhost:5146`.

```dotenv
VITE_API_URL=
VITE_GOOGLE_CLIENT_ID=
```

Set `VITE_GOOGLE_CLIENT_ID` only if Google sign-in is configured. It must have the same OAuth
Web client ID as `Google__ClientId` in `backend/.env`.

## 4. Database setup

Verify that SQL Server is running.

Then install and verify the Entity Framework CLI:

```powershell
dotnet tool install --global dotnet-ef --version 10.0.0
dotnet ef --version
```

From the repository root:

```powershell
cd backend
dotnet restore
dotnet ef database update
```

This applies migrations and creates or updates `MoneyMindAI`.

The seeder then creates:

- `Admin` and `User` roles
- Default system categories
- The default AI daily message limit
- An administrator if seed credentials are configured

The seeder is safe to run repeatedly. It does not overwrite existing values.

For a clean database, create a local database and update the connection string before running
`dotnet ef database update`. Do not delete migration files or manually edit the model snapshot.

## 5. Run the AI service

Open terminal 1:

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python run.py
```

Default URL:

```text
http://127.0.0.1:8001
```

Keep this service private. Only the backend must call it.

### Verify AI service

```powershell
$headers = @{ "X-Service-Key" = "<SERVICE_KEY>" }
Invoke-RestMethod -Uri "http://127.0.0.1:8001/health" -Headers $headers
```

The Python health endpoint checks Gemini availability and requires the shared service key.

## 6. Run the backend

Open terminal 2:

```powershell
cd backend
dotnet restore
dotnet build
dotnet run --launch-profile http
```

Default HTTP URL:

```text
http://localhost:5146
```

Development endpoints:

| Endpoint | URL |
|---|---|
| API health | `http://localhost:5146/api/health` |
| Swagger/OpenAPI UI | `http://localhost:5146/swagger` |
| OpenAPI document | `http://localhost:5146/openapi/v1.json` |
| SignalR notifications | `ws://localhost:5146/hubs/notifications` |

### Verify backend

```powershell
Invoke-RestMethod -Uri "http://localhost:5146/api/health"
```

Healthy result:

```json
{
  "status": "Healthy",
  "checkedAt": "..."
}
```

If the database is unavailable, the endpoint returns `503` with status `Unhealthy`.

## 7. Run the frontend

Open terminal 3:

```powershell
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open:

```text
http://localhost:5173
```

Vite forwards `/api` requests to `http://localhost:5146`.

Build and preview:

```powershell
pnpm build
pnpm preview
```

Vite preview uses the configured preview port unless overridden by Vite options.

## 8. Google sign-in setup

For an optional local Google sign-in test:

1. Create or select an OAuth 2.0 client of type **Web application** in Google Cloud.
2. Add `http://localhost:5173` to authorized JavaScript origins.
3. Set `Google__ClientId` in `backend/.env`.
4. Set `VITE_GOOGLE_CLIENT_ID` in `frontend/.env.local`.
5. Restart both frontend and backend.

The backend verifies the Google ID token. The client ID is public and can be exposed to the browser,
but the configured OAuth application must match the one used by the backend.

## 9. Running tests

### AI service tests

```powershell
cd ai-service
.\.venv\Scripts\Activate.ps1
python -m unittest discover -s tests -v
```

These tests cover model fallback, cooldown, timeout/error classification and unusable responses.

### Backend tests

No test project is currently present. Do not add tests to the backend project itself unless a
separate test project is created.

Before release, use integration tests for:

- Authentication and role authorization
- Refresh-token and session behavior
- Transaction, account, category and budget ownership
- Dashboard/report calculations
- AI quota enforcement
- Admin endpoints

### Frontend tests

No frontend test runner is currently configured. The frontend package currently provides `dev`,
`build` and `preview` scripts. A test runner should be added as a separate change before writing
Vitest or Playwright tests.

## 10. Common commands

### Backend

```powershell
cd backend
dotnet restore
dotnet build
dotnet run --launch-profile http
dotnet ef migrations add <MigrationName>
dotnet ef database update
dotnet ef migrations remove
```

### Frontend

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm preview
```

### AI service

```powershell
cd ai-service
.\.venv\Scripts\Activate.ps1
python run.py
python -m unittest discover -s tests -v
```

## 11. Troubleshooting

### `dotnet` is missing or the wrong SDK opens

```powershell
dotnet --list-sdks
dotnet --version
```

Install .NET 10 SDK and reopen the terminal or VS Code.

### The backend cannot find `DefaultConnection`

Confirm `backend/.env` contains:

```dotenv
ConnectionStrings__DefaultConnection="..."
```

Environment variables already set by the host take precedence over values in `.env`.

### Required JWT or encryption configuration is missing

The backend validates configuration during startup. Set:

- `Jwt__Key`: at least 32 characters
- `Encryption__MasterKey`: Base64-encoded 32-byte key
- `AIService__ServiceKey`: at least 32 characters

Never change `Encryption__MasterKey` after encrypted application data has been stored.

### SQL Server cannot be reached

Check:

- SQL Server service is running
- Server instance name is correct
- Windows authentication or credentials are valid
- Firewall allows the local SQL Server instance
- `TrustServerCertificate=True` is present for the local development connection

For SQL Server Express, replace `localhost` with `localhost\SQLEXPRESS` where appropriate.

### `dotnet ef` is missing

```powershell
dotnet tool install --global dotnet-ef --version 10.0.0
dotnet ef --version
```

If the tool is installed but not found, add the .NET tools directory to `PATH`:

```powershell
$env:USERPROFILE\.dotnet\tools
```

### Frontend does not receive API responses

Check in this order:

1. Backend is running on port `5146`.
2. Vite is running on port `5173`.
3. `VITE_API_URL` in `frontend/.env.local` is empty for the default proxy setup.
4. The browser does not show a stale cached build.
5. Restart Vite after changing `.env.local`.

### AI requests fail

Check:

1. `ai-service/.env` contains a valid Gemini API key.
2. `SERVICE_KEY` and `AIService__ServiceKey` are exactly equal.
3. AI service is running on `127.0.0.1:8001`.
4. The selected model is available to the configured Gemini key.
5. Backend logs do not contain a service URL or timeout misconfiguration.

### SMTP password reset is not sent

Leave `Smtp__Host` empty for local development to log the reset link. To send real email,
configure the SMTP host, port, SSL, username, password and from address.

## 12. Security rules

- Never commit `.env`, `.env.local`, `appsettings.Local.json`, private keys or credentials.
- Generate separate secrets for development and production.
- Never expose `GEMINI_API_KEY`, SMTP password or AI service key in frontend code.
- Use strong admin seed credentials only in local or controlled environments.
- Use HTTPS and restricted CORS origins in production.
- Do not change the encryption master key after encrypted data exists.
- Review every change involving authentication, authorization or financial calculations.

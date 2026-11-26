using System.Net;
using System.Net.Mail;
using System.Net.Sockets;
using System.Reflection;
using backend.Controllers;
using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Options;
using backend.Services.Implementations;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace backend.Tests;

// ---------------------------------------------------------------- helpers

public sealed class ListLogger<T> : ILogger<T>
{
    public List<(LogLevel Level, string Message)> Entries { get; } = [];
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
        Func<TState, Exception?, string> formatter) => Entries.Add((logLevel, formatter(state, exception)));
}

public sealed class FakeEnvironment(string name) : IHostEnvironment
{
    public string EnvironmentName { get; set; } = name;
    public string ApplicationName { get; set; } = "tests";
    public string ContentRootPath { get; set; } = ".";
    public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
}

// ---------------------------------------------------------------- DbSeeder

public class DbSeederTests : IdentityTestBase
{
    private async Task Seed(string email = "Admin@Example.com", string password = "Admin-pass1")
    {
        var provider = BuildProvider(s => s.Configure<SeedOptions>(o =>
        {
            o.AdminEmail = email;
            o.AdminPassword = password;
            o.AdminFullName = "Root Admin";
        }));
        await DbSeeder.SeedAsync(provider);
    }

    [Fact]
    public async Task Seeds17SystemCategories_11ExpenseAnd6Income()
    {
        await Seed();
        var system = Db.Categories.Where(c => c.IsSystem).ToList();
        Assert.Equal(17, system.Count);
        Assert.Equal(11, system.Count(c => c.Type == CategoryType.Expense));
        Assert.Equal(6, system.Count(c => c.Type == CategoryType.Income));
    }

    [Fact]
    public async Task SeededCategoriesAreActiveSystemOnesWithoutAnOwner()
    {
        await Seed();
        Assert.All(Db.Categories.Where(c => c.IsSystem).ToList(), c =>
        {
            Assert.True(c.IsActive);
            Assert.Null(c.UserId);
            Assert.False(string.IsNullOrWhiteSpace(c.Icon));
            Assert.Matches("^#[0-9A-F]{6}$", c.Color!);
        });
    }

    [Fact]
    public async Task SeededCategoryNamesAreUniquePerType()
    {
        await Seed();
        var names = Db.Categories.Where(c => c.IsSystem).Select(c => new { c.Name, c.Type }).ToList();
        Assert.Equal(names.Count, names.Distinct().Count());
    }

    [Fact]
    public async Task SeedingTwiceCreatesNoDuplicates()
    {
        await Seed();
        await Seed();
        Assert.Equal(17, Db.Categories.Count(c => c.IsSystem));
        Assert.Single(Db.Users.Where(u => u.Email == "admin@example.com"));
        Assert.Single(Db.SystemSettings);
    }

    [Fact]
    public async Task ExistingCategoryIsNotDuplicatedEvenWithDifferentCase()
    {
        AddCategory("LƯƠNG", CategoryType.Income, system: true);
        await Seed();
        Assert.Single(Db.Categories.AsEnumerable().Where(c =>
            c.IsSystem && c.Type == CategoryType.Income && string.Equals(c.Name, "lương", StringComparison.OrdinalIgnoreCase)));
        Assert.Equal(17, Db.Categories.Count(c => c.IsSystem));
    }

    [Fact]
    public async Task UserCategoriesWithTheSameNameDoNotBlockSeeding()
    {
        AddCategory("Lương", CategoryType.Income);
        await Seed();
        Assert.Equal(17, Db.Categories.Count(c => c.IsSystem));
    }

    [Fact]
    public async Task CreatesTheAdminAccountWithLowerCaseEmailAndAdminRole()
    {
        await Seed("Admin@Example.COM");
        var admin = await Users.FindByEmailAsync("admin@example.com");
        Assert.NotNull(admin);
        Assert.Equal("Root Admin", admin!.FullName);
        Assert.True(admin.EmailConfirmed);
        Assert.True(await Users.IsInRoleAsync(admin, Roles.Admin));
        Assert.True(await Users.CheckPasswordAsync(admin, "Admin-pass1"));
    }

    [Fact]
    public async Task CreatesBothRolesWhenMissing()
    {
        foreach (var role in RoleMgr.Roles.ToList()) await RoleMgr.DeleteAsync(role);
        await Seed();
        Assert.True(await RoleMgr.RoleExistsAsync(Roles.Admin));
        Assert.True(await RoleMgr.RoleExistsAsync(Roles.User));
    }

    [Fact]
    public async Task ExistingAdminKeepsTheirPassword()
    {
        await Seed(password: "Admin-pass1");
        await Seed(password: "Different-pass2");
        var admin = (await Users.FindByEmailAsync("admin@example.com"))!;
        Assert.True(await Users.CheckPasswordAsync(admin, "Admin-pass1"));
    }

    [Fact]
    public async Task ExistingUserWithTheAdminEmailIsPromotedToAdmin()
    {
        var existing = await CreateUserAsync("admin@example.com", role: Roles.User);
        await Seed();
        Assert.True(await Users.IsInRoleAsync(existing, Roles.Admin));
        Assert.Single(Db.Users.Where(u => u.Email == "admin@example.com"));
    }

    [Theory]
    [InlineData("", "Admin-pass1")]
    [InlineData("admin@example.com", "")]
    [InlineData("  ", "  ")]
    public async Task MissingAdminSettings_SkipTheAdminButStillSeedEverythingElse(string email, string password)
    {
        await Seed(email, password);
        Assert.DoesNotContain(Db.Users.ToList(), u => u.FullName == "Root Admin");
        Assert.Equal(17, Db.Categories.Count(c => c.IsSystem));
    }

    [Fact]
    public async Task WeakAdminPassword_FailsLoudly() =>
        await Assert.ThrowsAsync<InvalidOperationException>(() => Seed(password: "weak"));

    [Fact]
    public async Task SeedsTheDefaultAIQuotaSetting()
    {
        await Seed();
        var setting = Db.SystemSettings.Single(s => s.Key == AIQuota.DefaultSettingKey);
        Assert.Equal("20", setting.Value);
        Assert.Equal("system", setting.UpdatedBy);
    }

    [Fact]
    public async Task AnAdminChangedQuotaSettingIsNeverOverwritten()
    {
        Db.SystemSettings.Add(new SystemSetting { Key = AIQuota.DefaultSettingKey, Value = "50" });
        Db.SaveChanges();
        await Seed();
        Assert.Equal("50", Db.SystemSettings.Single().Value);
    }
}

// ---------------------------------------------------------------- HealthCheckService

public class HealthCheckServiceTests : DbTestBase
{
    private HealthCheckService Create(IAIServiceClient? ai = null, SmtpOptions? smtp = null)
    {
        var services = new ServiceCollection();
        if (ai is not null) services.AddSingleton(ai);
        return new HealthCheckService(Db, services.BuildServiceProvider(),
            Microsoft.Extensions.Options.Options.Create(smtp ?? new SmtpOptions()), NullLogger<HealthCheckService>.Instance);
    }

    private sealed class StubAI(Func<bool> healthy) : IAIServiceClient
    {
        public Task<bool> IsHealthyAsync(CancellationToken cancellationToken = default) => Task.FromResult(healthy());
        public Task<backend.DTOs.AIChatResult> ChatAsync(backend.DTOs.AIChatPayload payload, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<backend.DTOs.AIChatResult> StreamChatAsync(backend.DTOs.AIChatPayload payload, Func<string, Task>? onDelta, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<backend.DTOs.AICategorizeReply> CategorizeAsync(backend.DTOs.AICategorizePayload payload, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<backend.DTOs.AIInsightResult> GenerateInsightsAsync(backend.DTOs.AIInsightPayload payload, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    // ---- Check ----

    [Fact]
    public async Task Check_ReportsDatabaseAiAndEmailServices()
    {
        var result = await Create(new StubAI(() => true)).CheckAsync();
        Assert.Equal(["Database", "AIService", "Email"], result.Services.Select(s => s.ServiceName));
    }

    [Fact]
    public async Task Check_DatabaseIsHealthyAndHasALatency()
    {
        var db = (await Create().CheckAsync()).Services.Single(s => s.ServiceName == "Database");
        Assert.Equal(HealthCheckService.Healthy, db.Status);
        Assert.NotNull(db.LatencyMs);
    }

    [Fact]
    public async Task Check_MissingAiClientIsNotConfigured()
    {
        var ai = (await Create().CheckAsync()).Services.Single(s => s.ServiceName == "AIService");
        Assert.Equal(HealthCheckService.NotConfigured, ai.Status);
        Assert.Null(ai.LatencyMs);
    }

    [Fact]
    public async Task Check_HealthyAiClient()
    {
        var ai = (await Create(new StubAI(() => true)).CheckAsync()).Services.Single(s => s.ServiceName == "AIService");
        Assert.Equal(HealthCheckService.Healthy, ai.Status);
    }

    [Fact]
    public async Task Check_UnhealthyAiClient()
    {
        var ai = (await Create(new StubAI(() => false)).CheckAsync()).Services.Single(s => s.ServiceName == "AIService");
        Assert.Equal(HealthCheckService.Unhealthy, ai.Status);
    }

    [Fact]
    public async Task Check_AiClientThatThrows_IsUnhealthyWithTheMessage()
    {
        var ai = (await Create(new StubAI(() => throw new InvalidOperationException("connection refused"))).CheckAsync())
            .Services.Single(s => s.ServiceName == "AIService");
        Assert.Equal(HealthCheckService.Unhealthy, ai.Status);
        Assert.Equal("connection refused", ai.Message);
    }

    [Fact]
    public async Task Check_EmailWithoutSmtpHostIsNotConfigured()
    {
        var email = (await Create().CheckAsync()).Services.Single(s => s.ServiceName == "Email");
        Assert.Equal(HealthCheckService.NotConfigured, email.Status);
    }

    [Fact]
    public async Task Check_EmailIsHealthyWhenTheSmtpServerAcceptsConnections()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var email = (await Create(smtp: new SmtpOptions { Host = "127.0.0.1", Port = port }).CheckAsync())
                .Services.Single(s => s.ServiceName == "Email");
            Assert.Equal(HealthCheckService.Healthy, email.Status);
        }
        finally
        {
            listener.Stop();
        }
    }

    [Fact]
    public async Task Check_EmailIsUnhealthyWhenNothingListens()
    {
        var email = (await Create(smtp: new SmtpOptions { Host = "127.0.0.1", Port = FreePort() }).CheckAsync())
            .Services.Single(s => s.ServiceName == "Email");
        Assert.Equal(HealthCheckService.Unhealthy, email.Status);
        Assert.False(string.IsNullOrEmpty(email.Message));
    }

    [Fact]
    public async Task Check_OverallIsHealthyWhenOtherServicesAreMerelyNotConfigured()
    {
        Assert.Equal(HealthCheckService.Healthy, (await Create().CheckAsync()).OverallStatus);
    }

    [Fact]
    public async Task Check_OverallIsDegradedWhenANonCriticalServiceFails()
    {
        Assert.Equal(HealthCheckService.Degraded, (await Create(new StubAI(() => false)).CheckAsync()).OverallStatus);
    }

    [Fact]
    public async Task Check_StoresOneRowPerServiceEachRun()
    {
        var sut = Create();
        await sut.CheckAsync();
        await sut.CheckAsync();
        Assert.Equal(6, Db.ServiceHealthChecks.Count());
    }

    [Fact]
    public async Task Check_RemovesHistoryOlderThan30Days()
    {
        Db.ServiceHealthChecks.Add(new ServiceHealthCheck { ServiceName = "Old", Status = "Healthy", CheckedAt = DateTime.UtcNow.AddDays(-31) });
        Db.ServiceHealthChecks.Add(new ServiceHealthCheck { ServiceName = "Recent", Status = "Healthy", CheckedAt = DateTime.UtcNow.AddDays(-29) });
        Db.SaveChanges();
        await Create().CheckAsync();
        Assert.DoesNotContain(Db.ServiceHealthChecks.ToList(), c => c.ServiceName == "Old");
        Assert.Contains(Db.ServiceHealthChecks.ToList(), c => c.ServiceName == "Recent");
    }

    // ---- GetLatest / history ----

    [Fact]
    public async Task GetLatest_WithNoHistory_IsUnknown()
    {
        var result = await Create().GetLatestAsync();
        Assert.Equal("Unknown", result.OverallStatus);
        Assert.Empty(result.Services);
    }

    [Fact]
    public async Task GetLatest_ReturnsTheNewestRowPerServiceSortedByName()
    {
        var now = DateTime.UtcNow;
        Db.ServiceHealthChecks.AddRange(
            new ServiceHealthCheck { ServiceName = "Database", Status = "Unhealthy", CheckedAt = now.AddMinutes(-10) },
            new ServiceHealthCheck { ServiceName = "Database", Status = "Healthy", CheckedAt = now },
            new ServiceHealthCheck { ServiceName = "AIService", Status = "Healthy", CheckedAt = now.AddMinutes(-5) });
        Db.SaveChanges();
        var result = await Create().GetLatestAsync();
        Assert.Equal(["AIService", "Database"], result.Services.Select(s => s.ServiceName));
        Assert.Equal("Healthy", result.Services.Single(s => s.ServiceName == "Database").Status);
    }

    [Fact]
    public async Task GetLatest_DatabaseDownMeansUnhealthyOverall()
    {
        Db.ServiceHealthChecks.AddRange(
            new ServiceHealthCheck { ServiceName = "Database", Status = "Unhealthy" },
            new ServiceHealthCheck { ServiceName = "Email", Status = "Healthy" });
        Db.SaveChanges();
        Assert.Equal("Unhealthy", (await Create().GetLatestAsync()).OverallStatus);
    }

    [Fact]
    public async Task GetLatest_OtherServiceDownMeansDegraded()
    {
        Db.ServiceHealthChecks.AddRange(
            new ServiceHealthCheck { ServiceName = "Database", Status = "Healthy" },
            new ServiceHealthCheck { ServiceName = "Email", Status = "Unhealthy" });
        Db.SaveChanges();
        Assert.Equal("Degraded", (await Create().GetLatestAsync()).OverallStatus);
    }

    [Fact]
    public async Task GetLatest_AllHealthy()
    {
        Db.ServiceHealthChecks.Add(new ServiceHealthCheck { ServiceName = "Database", Status = "Healthy" });
        Db.SaveChanges();
        Assert.Equal("Healthy", (await Create().GetLatestAsync()).OverallStatus);
    }

    [Fact]
    public async Task GetHistory_IsNewestFirstAndFilterableByService()
    {
        var now = DateTime.UtcNow;
        Db.ServiceHealthChecks.AddRange(
            new ServiceHealthCheck { ServiceName = "Database", Status = "a", CheckedAt = now.AddMinutes(-2) },
            new ServiceHealthCheck { ServiceName = "Database", Status = "b", CheckedAt = now },
            new ServiceHealthCheck { ServiceName = "Email", Status = "c", CheckedAt = now.AddMinutes(-1) });
        Db.SaveChanges();
        var sut = Create();
        Assert.Equal(["b", "c", "a"], (await sut.GetHistoryAsync(null)).Select(c => c.Status));
        Assert.Equal(["b", "a"], (await sut.GetHistoryAsync("Database")).Select(c => c.Status));
        Assert.Equal(3, (await sut.GetHistoryAsync("  ")).Count);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(-5, 1)]
    [InlineData(2, 2)]
    [InlineData(1000, 3)]
    public async Task GetHistory_ClampsTheRequestedSize(int take, int expected)
    {
        for (var i = 0; i < 3; i++)
            Db.ServiceHealthChecks.Add(new ServiceHealthCheck { ServiceName = "Database", Status = "x", CheckedAt = DateTime.UtcNow.AddMinutes(-i) });
        Db.SaveChanges();
        Assert.Equal(expected, (await Create().GetHistoryAsync(null, take)).Count);
    }

    // ---- System stats ----

    [Fact]
    public async Task Stats_CountsUsersByState()
    {
        Db.Users.Single(u => u.Id == OtherUserId).IsActive = false;
        Db.SaveChanges();
        var stats = await Create().GetSystemStatsAsync();
        Assert.Equal(2, stats.TotalUsers);
        Assert.Equal(1, stats.ActiveUsers);
        Assert.Equal(1, stats.LockedUsers);
    }

    [Fact]
    public async Task Stats_NewUsersOnlyCountsTheLastSevenDays()
    {
        Db.Users.Single(u => u.Id == OtherUserId).CreatedAt = DateTime.UtcNow.AddDays(-8);
        Db.SaveChanges();
        Assert.Equal(1, (await Create().GetSystemStatsAsync()).NewUsersLast7Days);
    }

    [Fact]
    public async Task Stats_CountsTransactionsAndLiveConversations()
    {
        var account = AddAccount();
        AddTransaction(account, AddCategory("Food"), 10m);
        Db.AIConversations.AddRange(
            new AIConversation { UserId = UserId, TitleCipher = [1], TitleNonce = new byte[12] },
            new AIConversation { UserId = UserId, TitleCipher = [1], TitleNonce = new byte[12], DeletedAt = DateTime.UtcNow });
        Db.SaveChanges();
        var stats = await Create().GetSystemStatsAsync();
        Assert.Equal(1, stats.TotalTransactions);
        Assert.Equal(1, stats.TotalConversations);
    }

    [Fact]
    public async Task Stats_CountsAiRequestsAndFailuresOfTheLast24Hours()
    {
        void Add(AIProcessingStatus status, double hoursAgo) => Db.AIProcessingLogs.Add(new AIProcessingLog
        {
            UserId = UserId, RequestId = Guid.NewGuid(), TaskType = "Chat", Status = status,
            CreatedAt = DateTime.UtcNow.AddHours(-hoursAgo)
        });
        Add(AIProcessingStatus.Completed, 1);
        Add(AIProcessingStatus.Failed, 2);
        Add(AIProcessingStatus.Failed, 30);
        Db.SaveChanges();
        var stats = await Create().GetSystemStatsAsync();
        Assert.Equal(2, stats.AIRequestsLast24Hours);
        Assert.Equal(1, stats.AIFailuresLast24Hours);
    }
}

// ---------------------------------------------------------------- EmailService

public class EmailServiceTests
{
    private static (EmailService Service, ListLogger<EmailService> Log) Create(SmtpOptions? smtp = null,
        string environment = "Development", string frontend = "http://web.local/", int minutes = 45)
    {
        var log = new ListLogger<EmailService>();
        var service = new EmailService(Microsoft.Extensions.Options.Options.Create(smtp ?? new SmtpOptions()),
            Microsoft.Extensions.Options.Options.Create(new AppOptions { FrontendUrl = frontend, PasswordResetMinutes = minutes }),
            new FakeEnvironment(environment), log);
        return (service, log);
    }

    [Fact]
    public async Task NoSmtp_InDevelopment_PrintsTheEmailToTheLog()
    {
        var (service, log) = Create();
        await service.SendAsync("a@x.com", "Subject", "<b>body</b>");
        var entry = Assert.Single(log.Entries);
        Assert.Equal(LogLevel.Warning, entry.Level);
        Assert.Contains("<b>body</b>", entry.Message);
        Assert.Contains("a@x.com", entry.Message);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task NoSmtp_OutsideDevelopment_LogsAnErrorWithoutTheBody(string environment)
    {
        var (service, log) = Create(environment: environment);
        await service.SendAsync("a@x.com", "Subject", "SECRET-BODY");
        var entry = Assert.Single(log.Entries);
        Assert.Equal(LogLevel.Error, entry.Level);
        Assert.DoesNotContain("SECRET-BODY", entry.Message);
    }

    [Fact]
    public async Task NoSmtp_NeverThrows()
    {
        var (service, _) = Create(environment: "Production");
        await service.SendAsync("a@x.com", "s", "b");
    }

    [Fact]
    public async Task UnreachableSmtpServer_Throws()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        var (service, _) = Create(new SmtpOptions { Host = "127.0.0.1", Port = port, EnableSsl = false });
        await Assert.ThrowsAnyAsync<Exception>(() => service.SendAsync("a@x.com", "s", "b"));
    }

    [Fact]
    public async Task ResetEmail_InDevelopment_LogsTheLinkWithTheEscapedToken()
    {
        var (service, log) = Create(frontend: "http://web.local/");
        await service.SendPasswordResetAsync("a@x.com", "An", "tok+en/1");
        Assert.Contains(log.Entries, e => e.Message.Contains("http://web.local/reset-password?token=tok%2Ben%2F1"));
    }

    [Fact]
    public async Task ResetEmail_FrontendUrlTrailingSlashesAreHandled()
    {
        var (service, log) = Create(frontend: "http://web.local///");
        await service.SendPasswordResetAsync("a@x.com", "An", "abc");
        Assert.Contains(log.Entries, e => e.Message.Contains("http://web.local/reset-password?token=abc") && !e.Message.Contains("local//"));
    }

    [Fact]
    public async Task ResetEmail_BodyHtmlEncodesTheUsersName()
    {
        var (service, log) = Create();
        await service.SendPasswordResetAsync("a@x.com", "<script>alert(1)</script>", "abc");
        var mail = log.Entries.Single(e => e.Message.Contains("Email to"));
        Assert.DoesNotContain("<script>", mail.Message);
        Assert.Contains("&lt;script&gt;", mail.Message);
    }

    [Fact]
    public async Task ResetEmail_BodyStatesTheExpiryMinutes()
    {
        var (service, log) = Create(minutes: 45);
        await service.SendPasswordResetAsync("a@x.com", "An", "abc");
        Assert.Contains(log.Entries, e => e.Message.Contains("45 phút"));
    }

    [Fact]
    public async Task ResetEmail_InProduction_NeverLogsTheLinkOrToken()
    {
        var (service, log) = Create(environment: "Production");
        await service.SendPasswordResetAsync("a@x.com", "An", "very-secret-token");
        Assert.DoesNotContain(log.Entries, e => e.Message.Contains("very-secret-token"));
    }
}

// ---------------------------------------------------------------- controllers

public class ControllerBehaviourTests : IdentityTestBase
{
    private sealed class FakeAuth : IAuthService
    {
        public List<string> Calls { get; } = [];
        private static AuthResponse Auth() =>
            new("access", "refresh", DateTime.UtcNow, new UserResponse(Guid.NewGuid(), "n", "e@x.com", null, null, "UTC", ["User"], DateTime.UtcNow, null, true));

        public Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken ct = default) { Calls.Add("register"); return Task.FromResult(Auth()); }
        public Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken ct = default) { Calls.Add("login"); return Task.FromResult(Auth()); }
        public Task<AuthResponse> GoogleLoginAsync(GoogleLoginRequest request, CancellationToken ct = default) { Calls.Add("google"); return Task.FromResult(Auth()); }
        public Task<AuthResponse> RefreshAsync(RefreshTokenRequest request, CancellationToken ct = default) { Calls.Add("refresh"); return Task.FromResult(Auth()); }
        public Task LogoutAsync(string refreshToken, CancellationToken ct = default) { Calls.Add("logout:" + refreshToken); return Task.CompletedTask; }
        public Task LogoutAllAsync(Guid userId, CancellationToken ct = default) { Calls.Add("logoutAll:" + userId); return Task.CompletedTask; }
        public Task ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken ct = default) { Calls.Add("forgot:" + request.Email); return Task.CompletedTask; }
        public Task ResetPasswordAsync(ResetPasswordRequest request, CancellationToken ct = default) { Calls.Add("reset"); return Task.CompletedTask; }
        public Task<IReadOnlyList<SessionResponse>> GetSessionsAsync(Guid userId, CancellationToken ct = default) { Calls.Add("sessions:" + userId); return Task.FromResult<IReadOnlyList<SessionResponse>>([]); }
        public Task RevokeSessionAsync(Guid userId, Guid sessionId, CancellationToken ct = default) { Calls.Add($"revoke:{userId}:{sessionId}"); return Task.CompletedTask; }
    }

    // ---- Accounts ----

    [Fact]
    public async Task Accounts_GetAll_UsesTheSignedInUsersId()
    {
        AddAccount(UserId, "Mine");
        AddAccount(OtherUserId, "Theirs");
        var controller = new AccountsController(new AccountService(Db), new FakeCurrentUser(UserId));
        var ok = Assert.IsType<OkObjectResult>((await controller.GetAll(false, default)).Result);
        var items = Assert.IsAssignableFrom<IReadOnlyList<AccountResponse>>(ok.Value);
        Assert.Equal("Mine", Assert.Single(items).Name);
    }

    [Fact]
    public async Task Accounts_Create_Returns201PointingAtGetById()
    {
        var controller = new AccountsController(new AccountService(Db), new FakeCurrentUser(UserId));
        var result = await controller.Create(new CreateAccountRequest("New", AccountType.Cash, 5m), default);
        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal(nameof(AccountsController.GetById), created.ActionName);
        var account = Assert.IsType<AccountResponse>(created.Value);
        Assert.Equal(account.Id, created.RouteValues!["id"]);
    }

    [Fact]
    public async Task Accounts_Delete_Returns204()
    {
        var account = AddAccount();
        var controller = new AccountsController(new AccountService(Db), new FakeCurrentUser(UserId));
        Assert.IsType<NoContentResult>(await controller.Delete(account.Id, default));
    }

    [Fact]
    public async Task Accounts_AnotherUsersAccount_PropagatesNotFound()
    {
        var account = AddAccount(OtherUserId, "Theirs");
        var controller = new AccountsController(new AccountService(Db), new FakeCurrentUser(UserId));
        await Assert.ThrowsAsync<NotFoundException>(() => controller.GetById(account.Id, default));
    }

    // ---- AI usage / admin AI ----

    [Fact]
    public async Task AIUsage_ReturnsTheCallersQuota()
    {
        var current = new FakeCurrentUser(UserId);
        var controller = new AIUsageController(new AIQuotaService(Db, current, new FakeAudit()), current);
        var ok = Assert.IsType<OkObjectResult>((await controller.Get(default)).Result);
        var usage = Assert.IsType<AIUsageResponse>(ok.Value);
        Assert.Equal(20, usage.DailyLimit);
        Assert.Equal(0, usage.Used);
    }

    [Fact]
    public async Task AdminAI_GetQuota_ListsTheDefaultAndTheAllowedOptions()
    {
        var current = new FakeCurrentUser(UserId, true);
        var controller = new AdminAIController(new AIQuotaService(Db, current, new FakeAudit()));
        var ok = Assert.IsType<OkObjectResult>((await controller.GetQuota(default)).Result);
        var body = Assert.IsType<AIQuotaSettingsResponse>(ok.Value);
        Assert.Equal(20, body.DefaultDailyLimit);
        Assert.Equal([10, 20, 50, -1], body.Options);
    }

    [Fact]
    public async Task AdminAI_SetDefault_ReturnsTheNewDefault()
    {
        var current = new FakeCurrentUser(UserId, true);
        var controller = new AdminAIController(new AIQuotaService(Db, current, new FakeAudit()));
        var ok = Assert.IsType<OkObjectResult>((await controller.SetDefault(new SetDefaultAIQuotaRequest(50), default)).Result);
        Assert.Equal(50, Assert.IsType<AIQuotaSettingsResponse>(ok.Value).DefaultDailyLimit);
    }

    [Fact]
    public async Task AdminAI_SetDefault_InvalidValueIsRejected()
    {
        var current = new FakeCurrentUser(UserId, true);
        var controller = new AdminAIController(new AIQuotaService(Db, current, new FakeAudit()));
        await Assert.ThrowsAsync<BadRequestException>(() => controller.SetDefault(new SetDefaultAIQuotaRequest(7), default));
    }

    // ---- Auth ----

    [Fact]
    public async Task Auth_Register_Returns201()
    {
        var controller = new AuthController(new FakeAuth(), new FakeCurrentUser());
        var result = await controller.Register(new RegisterRequest("n", "a@b.com", "Password1"), default);
        Assert.Equal(201, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Auth_Login_Returns200WithTokens()
    {
        var controller = new AuthController(new FakeAuth(), new FakeCurrentUser());
        var ok = Assert.IsType<OkObjectResult>((await controller.Login(new LoginRequest("a@b.com", "x"), default)).Result);
        Assert.Equal("access", Assert.IsType<AuthResponse>(ok.Value).AccessToken);
    }

    [Fact]
    public async Task Auth_Logout_PassesTheRefreshTokenAndReturns204()
    {
        var auth = new FakeAuth();
        var controller = new AuthController(auth, new FakeCurrentUser());
        Assert.IsType<NoContentResult>(await controller.Logout(new LogoutRequest("rt-123"), default));
        Assert.Equal(["logout:rt-123"], auth.Calls);
    }

    [Fact]
    public async Task Auth_LogoutAll_UsesTheCurrentUser()
    {
        var auth = new FakeAuth();
        await new AuthController(auth, new FakeCurrentUser(UserId)).LogoutAll(default);
        Assert.Equal([$"logoutAll:{UserId}"], auth.Calls);
    }

    [Fact]
    public async Task Auth_Sessions_AreScopedToTheCurrentUser()
    {
        var auth = new FakeAuth();
        var sessionId = Guid.NewGuid();
        var controller = new AuthController(auth, new FakeCurrentUser(UserId));
        await controller.GetSessions(default);
        await controller.RevokeSession(sessionId, default);
        Assert.Equal([$"sessions:{UserId}", $"revoke:{UserId}:{sessionId}"], auth.Calls);
    }

    [Fact]
    public async Task Auth_ForgotPassword_AnswersTheSameWhateverTheEmail()
    {
        var controller = new AuthController(new FakeAuth(), new FakeCurrentUser());
        var a = Assert.IsType<OkObjectResult>((await controller.ForgotPassword(new ForgotPasswordRequest("known@x.com"), default)).Result);
        var b = Assert.IsType<OkObjectResult>((await controller.ForgotPassword(new ForgotPasswordRequest("unknown@x.com"), default)).Result);
        Assert.Equal(((MessageResponse)a.Value!).Message, ((MessageResponse)b.Value!).Message);
    }

    // ---- Health ----

    [Fact]
    public async Task Health_ReportsHealthyWithADatabase()
    {
        var result = await new HealthController(Db).Get(default);
        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Contains("Healthy", ok.Value!.ToString());
    }

    [Fact]
    public async Task Health_Reports503WhenTheDatabaseIsGone()
    {
        var controller = new HealthController(Db);
        Db.Dispose();
        var result = await controller.Get(default);
        Assert.Equal(503, Assert.IsType<ObjectResult>(result).StatusCode);
    }

    [Fact]
    public async Task Health_DoesNotLeakInternalDetails()
    {
        var text = ((OkObjectResult)await new HealthController(Db).Get(default)).Value!.ToString()!;
        Assert.DoesNotContain("Sqlite", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DataSource", text, StringComparison.OrdinalIgnoreCase);
    }
}

// ---------------------------------------------------------------- security contract of the whole API surface

public class ApiSecurityContractTests
{
    private static readonly Assembly BackendAssembly = typeof(AuthController).Assembly;

    private static readonly Type[] Controllers = BackendAssembly.GetTypes()
        .Where(t => t is { IsAbstract: false, IsPublic: true } && typeof(ControllerBase).IsAssignableFrom(t))
        .ToArray();

    private static IEnumerable<MethodInfo> Actions(Type controller) =>
        controller.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    private static bool HasAttr<T>(Type type) where T : Attribute => type.GetCustomAttributes<T>(inherit: true).Any();

    public static IEnumerable<object[]> ControllerNames() => Controllers.Select(c => new object[] { c.Name });

    private static Type Find(string name) => Controllers.Single(c => c.Name == name);

    [Fact]
    public void TheApiHasTheExpectedNumberOfControllers() => Assert.Equal(21, Controllers.Length);

    [Theory]
    [MemberData(nameof(ControllerNames))]
    public void EveryControllerIsAnApiController(string name) =>
        Assert.True(HasAttr<ApiControllerAttribute>(Find(name)));

    [Theory]
    [MemberData(nameof(ControllerNames))]
    public void EveryControllerHasAnApiRoute(string name)
    {
        var route = Find(name).GetCustomAttribute<RouteAttribute>();
        Assert.NotNull(route);
        Assert.StartsWith("api/", route!.Template);
    }

    [Theory]
    [MemberData(nameof(ControllerNames))]
    public void EveryEndpointRequiresAuthenticationUnlessExplicitlyAnonymous(string name)
    {
        var type = Find(name);
        var classProtected = HasAttr<AuthorizeAttribute>(type);
        var classAnonymous = HasAttr<AllowAnonymousAttribute>(type);
        foreach (var action in Actions(type))
        {
            var protectedAction = classProtected || action.GetCustomAttributes<AuthorizeAttribute>().Any();
            var anonymousAction = classAnonymous || action.GetCustomAttributes<AllowAnonymousAttribute>().Any();
            Assert.True(protectedAction || anonymousAction, $"{type.Name}.{action.Name} has no explicit auth rule.");
        }
    }

    [Theory]
    [MemberData(nameof(ControllerNames))]
    public void AdminControllersRequireTheAdminRole(string name)
    {
        var type = Find(name);
        var isAdminController = type.Name.StartsWith("Admin", StringComparison.Ordinal);
        var requiresAdmin = type.GetCustomAttributes<AuthorizeAttribute>(inherit: true)
            .Any(a => a.Roles is not null && a.Roles.Split(',').Contains(Roles.Admin));
        Assert.Equal(isAdminController, requiresAdmin);
    }

    [Theory]
    [MemberData(nameof(ControllerNames))]
    public void AdminRoutesLiveOnlyInAdminControllers(string name)
    {
        var type = Find(name);
        var template = type.GetCustomAttribute<RouteAttribute>()!.Template;
        Assert.Equal(type.Name.StartsWith("Admin", StringComparison.Ordinal), template.StartsWith("api/admin", StringComparison.Ordinal));
    }

    [Theory]
    [MemberData(nameof(ControllerNames))]
    public void NoAdminControllerIsAccidentallyAnonymous(string name)
    {
        var type = Find(name);
        if (!type.Name.StartsWith("Admin", StringComparison.Ordinal)) return;
        Assert.False(HasAttr<AllowAnonymousAttribute>(type));
        Assert.DoesNotContain(Actions(type), a => a.GetCustomAttributes<AllowAnonymousAttribute>().Any());
    }

    [Fact]
    public void OnlyTheExpectedEndpointsAreAnonymous()
    {
        var anonymous = Controllers
            .SelectMany(c => Actions(c).Where(a => HasAttr<AllowAnonymousAttribute>(c) || a.GetCustomAttributes<AllowAnonymousAttribute>().Any())
                .Select(a => $"{c.Name}.{a.Name}"))
            .OrderBy(x => x)
            .ToList();
        Assert.Equal(
        [
            "AuthController.ForgotPassword", "AuthController.Google", "AuthController.Login", "AuthController.Logout",
            "AuthController.Refresh", "AuthController.Register", "AuthController.ResetPassword", "HealthController.Get"
        ], anonymous);
    }

    [Fact]
    public void EveryEndpointDeclaresAnHttpVerb()
    {
        foreach (var type in Controllers)
        foreach (var method in type.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
                     .Where(m => m.ReturnType.IsGenericType && typeof(Task).IsAssignableFrom(m.ReturnType)
                                 || m.ReturnType == typeof(Task)))
            Assert.True(method.GetCustomAttributes<HttpMethodAttribute>().Any(), $"{type.Name}.{method.Name} has no HTTP verb.");
    }

    [Fact]
    public void NoTwoEndpointsShareTheSameVerbAndRoute()
    {
        var routes = Controllers.SelectMany(c =>
        {
            var prefix = c.GetCustomAttribute<RouteAttribute>()!.Template;
            return Actions(c).SelectMany(a => a.GetCustomAttributes<HttpMethodAttribute>().SelectMany(h =>
                h.HttpMethods.Select(verb => $"{verb} {prefix}/{h.Template}".TrimEnd('/'))));
        }).ToList();
        Assert.Equal(routes.Count, routes.Distinct().Count());
    }

    [Fact]
    public void IdsInRoutesAreConstrainedToGuids()
    {
        foreach (var c in Controllers)
        foreach (var template in Actions(c).SelectMany(a => a.GetCustomAttributes<HttpMethodAttribute>()).Select(h => h.Template))
            if (template is not null && template.Contains("{id") || template?.Contains("Id") == true)
                Assert.Contains(":guid", template);
    }

    [Fact]
    public void AuthEndpointsAreRateLimited()
    {
        Assert.Equal("auth", Find(nameof(AuthController)).GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
    }

    [Fact]
    public void ChatEndpointsAreRateLimited()
    {
        Assert.Equal("ai", Find(nameof(AIChatController)).GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
    }

    [Fact]
    public void ChangingThePasswordIsRateLimited()
    {
        var method = Find(nameof(UsersController)).GetMethods().Single(m => m.GetCustomAttributes<HttpPutAttribute>().Any(a => a.Template == "me/password"));
        Assert.Equal("auth", method.GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
    }

    [Theory]
    [InlineData(typeof(AccountsController))]
    [InlineData(typeof(BudgetsController))]
    [InlineData(typeof(CategoriesController))]
    [InlineData(typeof(DashboardController))]
    [InlineData(typeof(FinancialGoalsController))]
    [InlineData(typeof(NotificationsController))]
    [InlineData(typeof(TransactionsController))]
    [InlineData(typeof(AIChatController))]
    [InlineData(typeof(AIUsageController))]
    public void PerUserControllersDeriveFromTheUserBase(Type type) =>
        Assert.True(typeof(UserControllerBase).IsAssignableFrom(type));

    [Fact]
    public void AdminBaseRequiresTheAdminRole() =>
        Assert.Equal(Roles.Admin, typeof(AdminControllerBase).GetCustomAttribute<AuthorizeAttribute>()!.Roles);

    [Fact]
    public void UserBaseRequiresAnyAuthenticatedUser()
    {
        var attribute = typeof(UserControllerBase).GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(attribute);
        Assert.Null(attribute!.Roles);
    }
}

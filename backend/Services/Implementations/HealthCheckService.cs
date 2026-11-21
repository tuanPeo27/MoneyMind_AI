using System.Diagnostics;
using System.Net.Sockets;
using backend.Data;
using backend.DTOs.Responses;
using backend.Models;
using backend.Options;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services.Implementations;

public sealed class HealthCheckService(
    AppDbContext db,
    IServiceProvider services,
    IOptions<SmtpOptions> smtpOptions,
    ILogger<HealthCheckService> logger) : IHealthCheckService
{
    public const string Healthy = "Healthy";
    public const string Degraded = "Degraded";
    public const string Unhealthy = "Unhealthy";
    public const string NotConfigured = "NotConfigured";

    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan HistoryRetention = TimeSpan.FromDays(30);

    public async Task<SystemHealthResponse> CheckAsync(CancellationToken cancellationToken = default)
    {
        var results = new List<ServiceHealthCheck>
        {
            await ProbeAsync("Database", async ct => await db.Database.CanConnectAsync(ct), cancellationToken),
            await CheckAIServiceAsync(cancellationToken),
            await CheckEmailAsync(cancellationToken)
        };

        // Storing the result is best effort: when the database is down, the probe result itself is the answer.
        try
        {
            db.ServiceHealthChecks.AddRange(results);
            var cutoff = DateTime.UtcNow - HistoryRetention;
            await db.ServiceHealthChecks.Where(c => c.CheckedAt < cutoff).ExecuteDeleteAsync(cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not store health check results.");
        }

        return Build(results.Select(Map).ToList());
    }

    public async Task<SystemHealthResponse> GetLatestAsync(CancellationToken cancellationToken = default)
    {
        var latest = await db.ServiceHealthChecks.AsNoTracking()
            .Where(c => c.CheckedAt == db.ServiceHealthChecks
                .Where(x => x.ServiceName == c.ServiceName).Max(x => x.CheckedAt))
            .OrderBy(c => c.ServiceName)
            .ToListAsync(cancellationToken);

        return Build(latest.Select(Map).ToList());
    }

    public async Task<IReadOnlyList<HealthCheckResponse>> GetHistoryAsync(string? serviceName, int take = 50,
        CancellationToken cancellationToken = default)
    {
        var source = db.ServiceHealthChecks.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(serviceName)) source = source.Where(c => c.ServiceName == serviceName);

        return await source
            .OrderByDescending(c => c.CheckedAt)
            .Take(Math.Clamp(take, 1, 500))
            .Select(c => new HealthCheckResponse(c.ServiceName, c.Status, c.LatencyMs, c.Message, c.CheckedAt))
            .ToListAsync(cancellationToken);
    }

    public async Task<SystemStatsResponse> GetSystemStatsAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var weekAgo = now.AddDays(-7);
        var dayAgo = now.AddDays(-1);

        var totalUsers = await db.Users.CountAsync(cancellationToken);
        var activeUsers = await db.Users.CountAsync(u => u.IsActive, cancellationToken);
        var newUsers = await db.Users.CountAsync(u => u.CreatedAt >= weekAgo, cancellationToken);
        var transactions = await db.Transactions.CountAsync(cancellationToken);
        var conversations = await db.AIConversations.CountAsync(c => c.DeletedAt == null, cancellationToken);
        var aiRequests = await db.AIProcessingLogs.CountAsync(l => l.CreatedAt >= dayAgo, cancellationToken);
        var aiFailures = await db.AIProcessingLogs.CountAsync(
            l => l.CreatedAt >= dayAgo && l.Status == AIProcessingStatus.Failed, cancellationToken);

        return new SystemStatsResponse(totalUsers, activeUsers, totalUsers - activeUsers, newUsers, transactions,
            conversations, aiRequests, aiFailures);
    }

    // ---- probes ----

    private async Task<ServiceHealthCheck> CheckAIServiceAsync(CancellationToken cancellationToken)
    {
        var client = services.GetService<IAIServiceClient>();
        if (client is null)
            return Result("AIService", NotConfigured, null, "AI service client chưa được cấu hình.");

        return await ProbeAsync("AIService", ct => client.IsHealthyAsync(ct), cancellationToken);
    }

    private async Task<ServiceHealthCheck> CheckEmailAsync(CancellationToken cancellationToken)
    {
        var smtp = smtpOptions.Value;
        if (string.IsNullOrWhiteSpace(smtp.Host))
            return Result("Email", NotConfigured, null, "SMTP chưa được cấu hình.");

        // Only checks that the SMTP server accepts a connection. No email is sent.
        return await ProbeAsync("Email", async ct =>
        {
            using var client = new TcpClient();
            await client.ConnectAsync(smtp.Host, smtp.Port, ct);
            return client.Connected;
        }, cancellationToken);
    }

    private static async Task<ServiceHealthCheck> ProbeAsync(string name, Func<CancellationToken, Task<bool>> probe,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(ProbeTimeout);

        var stopwatch = Stopwatch.StartNew();
        string status;
        string? message = null;
        try
        {
            status = await probe(timeout.Token) ? Healthy : Unhealthy;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            status = Unhealthy;
            message = "Hết thời gian chờ.";
        }
        catch (Exception ex)
        {
            status = Unhealthy;
            message = ex.Message.Length <= 500 ? ex.Message : ex.Message[..500];
        }

        return Result(name, status, (int)stopwatch.ElapsedMilliseconds, message);
    }

    private static ServiceHealthCheck Result(string name, string status, int? latencyMs, string? message) =>
        new() { ServiceName = name, Status = status, LatencyMs = latencyMs, Message = message };

    private static HealthCheckResponse Map(ServiceHealthCheck c) =>
        new(c.ServiceName, c.Status, c.LatencyMs, c.Message, c.CheckedAt);

    /// <summary>Database down means the system is unhealthy. Other failed services only degrade it.</summary>
    private static SystemHealthResponse Build(IReadOnlyList<HealthCheckResponse> services)
    {
        string overall;
        if (services.Count == 0) overall = "Unknown";
        else if (services.Any(s => s.ServiceName == "Database" && s.Status == Unhealthy)) overall = Unhealthy;
        else if (services.Any(s => s.Status == Unhealthy)) overall = Degraded;
        else overall = Healthy;

        return new SystemHealthResponse(overall, services);
    }
}

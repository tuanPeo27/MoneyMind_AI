using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class AIProcessingLogService(AppDbContext db) : IAIProcessingLogService
{
    public async Task LogAsync(Guid? userId, Guid requestId, string taskType, string? provider, int durationMs,
        AIProcessingStatus status, string? errorCode = null, int? tokenUsage = null,
        CancellationToken cancellationToken = default)
    {
        db.AIProcessingLogs.Add(new AIProcessingLog
        {
            UserId = userId,
            RequestId = requestId,
            TaskType = Truncate(taskType)!,
            Provider = Truncate(provider),
            DurationMs = durationMs,
            Status = status,
            ErrorCode = Truncate(errorCode),
            TokenUsage = tokenUsage
        });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<PagedResult<AIProcessingLogResponse>> GetPagedAsync(AIProcessingLogQuery query,
        CancellationToken cancellationToken = default)
    {
        var source = db.AIProcessingLogs.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(query.TaskType)) source = source.Where(l => l.TaskType == query.TaskType);
        if (query.Status is { } status) source = source.Where(l => l.Status == status);
        if (query.UserId is { } userId) source = source.Where(l => l.UserId == userId);
        if (query.From is { } from) source = source.Where(l => l.CreatedAt >= DateRange.AsUtc(from));
        if (query.To is { } to) source = source.Where(l => l.CreatedAt < DateRange.EndExclusive(DateRange.AsUtc(to)));

        var total = await source.CountAsync(cancellationToken);
        var items = await source
            .OrderByDescending(l => l.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .Select(l => new AIProcessingLogResponse(l.Id, l.UserId, l.RequestId, l.TaskType, l.Provider,
                l.DurationMs, l.Status, l.ErrorCode, l.TokenUsage, l.CreatedAt))
            .ToListAsync(cancellationToken);

        return new PagedResult<AIProcessingLogResponse>(items, query.Page, query.PageSize, total);
    }

    public async Task<AIUsageStatsResponse> GetStatsAsync(DateTime from, DateTime to,
        CancellationToken cancellationToken = default)
    {
        var (start, end) = DateRange.Bounds(from, to);

        var rows = await db.AIProcessingLogs.AsNoTracking()
            .Where(l => l.CreatedAt >= start && l.CreatedAt < end)
            .GroupBy(l => l.TaskType)
            .Select(g => new
            {
                TaskType = g.Key,
                Count = g.Count(),
                Failed = g.Count(x => x.Status == AIProcessingStatus.Failed),
                AvgDuration = g.Average(x => (double)x.DurationMs),
                Tokens = g.Sum(x => (long)(x.TokenUsage ?? 0))
            })
            .ToListAsync(cancellationToken);

        var total = rows.Sum(r => r.Count);
        var avg = total == 0 ? 0 : rows.Sum(r => r.AvgDuration * r.Count) / total;

        return new AIUsageStatsResponse(
            from, to, total, rows.Sum(r => r.Failed), Math.Round(avg, 2), rows.Sum(r => r.Tokens),
            rows.OrderByDescending(r => r.Count)
                .Select(r => new AITaskStats(r.TaskType, r.Count, r.Failed, Math.Round(r.AvgDuration, 2)))
                .ToList());
    }

    private static string? Truncate(string? value) =>
        value is null ? null : value.Length <= 100 ? value : value[..100];
}

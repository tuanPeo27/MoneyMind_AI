using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class AuditService(AppDbContext db, ICurrentUserService currentUser) : IAuditService
{
    public async Task LogAsync(string action, string targetType, Guid? targetId = null, string? detail = null,
        CancellationToken cancellationToken = default)
    {
        db.AuditLogs.Add(new AuditLog
        {
            AdminId = currentUser.RequiredUserId,
            Action = Truncate(action, 100)!,
            TargetType = Truncate(targetType, 100)!,
            TargetId = targetId,
            Detail = Truncate(detail, 2000),
            IpAddress = currentUser.IpAddress
        });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<PagedResult<AuditLogResponse>> GetPagedAsync(AuditLogQuery query,
        CancellationToken cancellationToken = default)
    {
        var source = db.AuditLogs.AsNoTracking().AsQueryable();

        if (query.AdminId is { } adminId) source = source.Where(l => l.AdminId == adminId);
        if (!string.IsNullOrWhiteSpace(query.Action)) source = source.Where(l => l.Action == query.Action);
        if (!string.IsNullOrWhiteSpace(query.TargetType)) source = source.Where(l => l.TargetType == query.TargetType);
        if (query.From is { } from) source = source.Where(l => l.CreatedAt >= DateRange.AsUtc(from));
        if (query.To is { } to) source = source.Where(l => l.CreatedAt < DateRange.EndExclusive(DateRange.AsUtc(to)));

        var total = await source.CountAsync(cancellationToken);
        var items = await source
            .OrderByDescending(l => l.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .Select(l => new AuditLogResponse(l.Id, l.AdminId, l.Action, l.TargetType, l.TargetId, l.Detail,
                l.IpAddress, l.CreatedAt))
            .ToListAsync(cancellationToken);

        return new PagedResult<AuditLogResponse>(items, query.Page, query.PageSize, total);
    }

    private static string? Truncate(string? value, int max) =>
        value is null ? null : value.Length <= max ? value : value[..max];
}

using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class AnnouncementService(
    AppDbContext db,
    ICurrentUserService currentUser,
    IAuditService audit) : IAnnouncementService
{
    public async Task<PagedResult<AnnouncementResponse>> GetPagedAsync(PagingQuery paging,
        CancellationToken cancellationToken = default)
    {
        var total = await db.SystemAnnouncements.CountAsync(cancellationToken);
        var items = await db.SystemAnnouncements.AsNoTracking()
            .OrderByDescending(a => a.StartAt)
            .Skip((paging.Page - 1) * paging.PageSize)
            .Take(paging.PageSize)
            .Select(a => new AnnouncementResponse(a.Id, a.AdminId, a.Title, a.Content, a.StartAt, a.EndAt,
                a.IsActive, a.CreatedAt))
            .ToListAsync(cancellationToken);

        return new PagedResult<AnnouncementResponse>(items, paging.Page, paging.PageSize, total);
    }

    public async Task<IReadOnlyList<AnnouncementResponse>> GetActiveAsync(
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        return await db.SystemAnnouncements.AsNoTracking()
            .Where(a => a.IsActive && a.StartAt <= now && (a.EndAt == null || a.EndAt > now))
            .OrderByDescending(a => a.StartAt)
            .Select(a => new AnnouncementResponse(a.Id, a.AdminId, a.Title, a.Content, a.StartAt, a.EndAt,
                a.IsActive, a.CreatedAt))
            .ToListAsync(cancellationToken);
    }

    public async Task<AnnouncementResponse> CreateAsync(UpsertAnnouncementRequest request,
        CancellationToken cancellationToken = default)
    {
        var (startAt, endAt) = ValidateWindow(request);

        var announcement = new SystemAnnouncement
        {
            AdminId = currentUser.RequiredUserId,
            Title = request.Title.Trim(),
            Content = request.Content.Trim(),
            StartAt = startAt,
            EndAt = endAt,
            IsActive = request.IsActive
        };
        db.SystemAnnouncements.Add(announcement);
        await db.SaveChangesAsync(cancellationToken);

        await audit.LogAsync("CreateAnnouncement", "SystemAnnouncement", announcement.Id, announcement.Title,
            cancellationToken);
        return Map(announcement);
    }

    public async Task<AnnouncementResponse> UpdateAsync(Guid id, UpsertAnnouncementRequest request,
        CancellationToken cancellationToken = default)
    {
        var announcement = await db.SystemAnnouncements.FirstOrDefaultAsync(a => a.Id == id, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy thông báo hệ thống.");
        var (startAt, endAt) = ValidateWindow(request);

        announcement.Title = request.Title.Trim();
        announcement.Content = request.Content.Trim();
        announcement.StartAt = startAt;
        announcement.EndAt = endAt;
        announcement.IsActive = request.IsActive;
        await db.SaveChangesAsync(cancellationToken);

        await audit.LogAsync("UpdateAnnouncement", "SystemAnnouncement", id, announcement.Title, cancellationToken);
        return Map(announcement);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var deleted = await db.SystemAnnouncements.Where(a => a.Id == id).ExecuteDeleteAsync(cancellationToken);
        if (deleted == 0) throw new NotFoundException("Không tìm thấy thông báo hệ thống.");

        await audit.LogAsync("DeleteAnnouncement", "SystemAnnouncement", id, null, cancellationToken);
    }

    private static (DateTime StartAt, DateTime? EndAt) ValidateWindow(UpsertAnnouncementRequest request)
    {
        var startAt = DateRange.AsUtc(request.StartAt);
        DateTime? endAt = request.EndAt is { } end ? DateRange.AsUtc(end) : null;
        if (endAt is not null && endAt <= startAt)
            throw new BadRequestException("Thời gian kết thúc phải sau thời gian bắt đầu.");
        return (startAt, endAt);
    }

    private static AnnouncementResponse Map(SystemAnnouncement a) =>
        new(a.Id, a.AdminId, a.Title, a.Content, a.StartAt, a.EndAt, a.IsActive, a.CreatedAt);
}

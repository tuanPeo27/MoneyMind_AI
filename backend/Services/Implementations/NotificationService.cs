using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Hubs;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class NotificationService(
    AppDbContext db,
    IHubContext<NotificationHub> hub,
    ILogger<NotificationService> logger) : INotificationService
{
    public async Task<PagedResult<NotificationResponse>> GetPagedAsync(Guid userId, NotificationQuery query,
        CancellationToken cancellationToken = default)
    {
        var source = db.Notifications.AsNoTracking().Where(n => n.UserId == userId);
        if (query.UnreadOnly) source = source.Where(n => !n.IsRead);

        var total = await source.CountAsync(cancellationToken);
        var items = await source
            .OrderByDescending(n => n.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .Select(n => new NotificationResponse(n.Id, n.Type, n.Source, n.Title, n.Message, n.RelatedType,
                n.RelatedId, n.IsRead, n.CreatedAt))
            .ToListAsync(cancellationToken);

        return new PagedResult<NotificationResponse>(items, query.Page, query.PageSize, total);
    }

    public Task<int> GetUnreadCountAsync(Guid userId, CancellationToken cancellationToken = default) =>
        db.Notifications.CountAsync(n => n.UserId == userId && !n.IsRead, cancellationToken);

    public async Task MarkReadAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var notification = await db.Notifications
            .FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy thông báo.");

        if (notification.IsRead) return;
        notification.IsRead = true;
        await db.SaveChangesAsync(cancellationToken);
        await PushUnreadCountAsync(userId, cancellationToken);
    }

    public async Task MarkAllReadAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        await db.Notifications
            .Where(n => n.UserId == userId && !n.IsRead)
            .ExecuteUpdateAsync(setters => setters.SetProperty(n => n.IsRead, true), cancellationToken);
        await PushUnreadCountAsync(userId, cancellationToken);
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var deleted = await db.Notifications
            .Where(n => n.Id == id && n.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        if (deleted == 0) throw new NotFoundException("Không tìm thấy thông báo.");
        await PushUnreadCountAsync(userId, cancellationToken);
    }

    public async Task CreateAsync(Guid userId, NotificationType type, NotificationSource source, string title,
        string message, string? relatedType = null, Guid? relatedId = null,
        CancellationToken cancellationToken = default)
    {
        var notification = new Notification
        {
            UserId = userId,
            Type = type,
            Source = source,
            Title = Truncate(title, 200),
            Message = Truncate(message, 2000),
            RelatedType = relatedType,
            RelatedId = relatedId
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync(cancellationToken);

        // The notification is already stored; a failed push must not fail the caller.
        try
        {
            var payload = new NotificationResponse(notification.Id, notification.Type, notification.Source,
                notification.Title, notification.Message, notification.RelatedType, notification.RelatedId,
                notification.IsRead, notification.CreatedAt);
            await hub.Clients.User(userId.ToString())
                .SendAsync(NotificationEvents.ReceiveNotification, payload, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not push notification {NotificationId} to user {UserId}", notification.Id,
                userId);
        }

        await PushUnreadCountAsync(userId, cancellationToken);
    }

    private async Task PushUnreadCountAsync(Guid userId, CancellationToken cancellationToken)
    {
        try
        {
            var unread = await GetUnreadCountAsync(userId, cancellationToken);
            await hub.Clients.User(userId.ToString())
                .SendAsync(NotificationEvents.UnreadCountChanged, unread, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not push unread count to user {UserId}", userId);
        }
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}

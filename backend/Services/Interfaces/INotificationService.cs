using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Models;

namespace backend.Services.Interfaces;

public interface INotificationService
{
    Task<PagedResult<NotificationResponse>> GetPagedAsync(Guid userId, NotificationQuery query,
        CancellationToken cancellationToken = default);
    Task<int> GetUnreadCountAsync(Guid userId, CancellationToken cancellationToken = default);
    Task MarkReadAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
    Task MarkAllReadAsync(Guid userId, CancellationToken cancellationToken = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>Used by other services to push a notification to a user.</summary>
    Task CreateAsync(Guid userId, NotificationType type, NotificationSource source, string title, string message,
        string? relatedType = null, Guid? relatedId = null, CancellationToken cancellationToken = default);
}

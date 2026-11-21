using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/notifications")]
public sealed class NotificationsController(INotificationService service, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<NotificationResponse>>> GetPaged(
        [FromQuery] NotificationQuery query, CancellationToken ct) =>
        Ok(await service.GetPagedAsync(UserId, query, ct));

    [HttpGet("unread-count")]
    public async Task<ActionResult<UnreadCountResponse>> GetUnreadCount(CancellationToken ct) =>
        Ok(new UnreadCountResponse(await service.GetUnreadCountAsync(UserId, ct)));

    [HttpPut("{id:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid id, CancellationToken ct)
    {
        await service.MarkReadAsync(UserId, id, ct);
        return NoContent();
    }

    [HttpPut("read-all")]
    public async Task<IActionResult> MarkAllRead(CancellationToken ct)
    {
        await service.MarkAllReadAsync(UserId, ct);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteAsync(UserId, id, ct);
        return NoContent();
    }
}

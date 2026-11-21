using backend.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.IdentityModel.JsonWebTokens;

namespace backend.Hubs;

/// <summary>Client-side method names the server invokes.</summary>
public static class NotificationEvents
{
    /// <summary>Payload: <see cref="backend.DTOs.Responses.NotificationResponse"/>.</summary>
    public const string ReceiveNotification = "ReceiveNotification";

    /// <summary>Payload: int (current unread count).</summary>
    public const string UnreadCountChanged = "UnreadCountChanged";
}

/// <summary>
/// Real-time channel for the signed-in user's notifications. The server pushes events,
/// clients do not call any hub method. Each user is addressed through <see cref="Hub.Clients"/>.User(userId),
/// so every open tab and device of that user receives the event.
/// </summary>
[Authorize]
public sealed class NotificationHub(INotificationService notifications) : Hub
{
    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();

        if (Guid.TryParse(Context.UserIdentifier, out var userId))
        {
            var unread = await notifications.GetUnreadCountAsync(userId, Context.ConnectionAborted);
            await Clients.Caller.SendAsync(NotificationEvents.UnreadCountChanged, unread, Context.ConnectionAborted);
        }
    }
}

/// <summary>Maps a SignalR connection to the user id in the JWT "sub" claim (inbound claim mapping is disabled).</summary>
public sealed class SubClaimUserIdProvider : IUserIdProvider
{
    public string? GetUserId(HubConnectionContext connection) =>
        connection.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
}

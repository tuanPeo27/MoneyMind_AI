using backend.Models;

namespace backend.Services.Interfaces;

/// <param name="CustomLimit">The limit an admin set for this user; null means the user follows the system default.</param>
/// <param name="DailyLimit">The limit that applies today; null means unlimited.</param>
/// <param name="Used">Chat messages already answered since the user's local midnight.</param>
/// <param name="ResetsAt">UTC time of the user's next local midnight, when the count starts again.</param>
public sealed record AIQuotaStatus(int? CustomLimit, int? DailyLimit, int Used, DateTime ResetsAt)
{
    public bool IsUnlimited => DailyLimit is null;
    public int? Remaining => DailyLimit is { } limit ? Math.Max(0, limit - Used) : null;
}

/// <summary>Daily AI chat message limits per user. A day runs from midnight to midnight in the user's time zone.</summary>
public interface IAIQuotaService
{
    Task<AIQuotaStatus> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>One query for many users (admin list).</summary>
    Task<IReadOnlyDictionary<Guid, AIQuotaStatus>> GetStatusesAsync(IReadOnlyCollection<ApplicationUser> users,
        CancellationToken cancellationToken = default);

    /// <exception cref="backend.Helpers.TooManyRequestsException">The user has no messages left today.</exception>
    Task EnsureAvailableAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Admin: sets a user's limit (10, 20, 50 or -1 for unlimited); null returns the user to the default.</summary>
    Task<AIQuotaStatus> SetUserLimitAsync(Guid userId, int? limit, CancellationToken cancellationToken = default);

    /// <returns>10, 20, 50 or -1 (unlimited).</returns>
    Task<int> GetDefaultLimitAsync(CancellationToken cancellationToken = default);

    /// <summary>Admin: changes the limit of every user who has none of their own.</summary>
    Task SetDefaultLimitAsync(int limit, CancellationToken cancellationToken = default);
}

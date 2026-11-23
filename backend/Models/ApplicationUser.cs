using Microsoft.AspNetCore.Identity;

namespace backend.Models;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public ApplicationUser()
    {
        Id = Guid.NewGuid();
    }

    public string FullName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public string TimeZoneId { get; set; } = "Asia/Ho_Chi_Minh";

    /// <summary>
    /// AI chat messages allowed per day, set by an admin. null follows the system default,
    /// <see cref="backend.Helpers.AIQuota.Unlimited"/> (-1) means no limit.
    /// </summary>
    public int? AIDailyMessageLimit { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime? LockedAt { get; set; }
    public string? LockedReason { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

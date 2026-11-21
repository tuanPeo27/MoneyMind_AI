namespace backend.Services.Interfaces;

public interface ICurrentUserService
{
    /// <summary>Id of the authenticated user, or null for anonymous requests.</summary>
    Guid? UserId { get; }

    /// <summary>Id of the authenticated user. Throws when the request is anonymous.</summary>
    Guid RequiredUserId { get; }

    bool IsAdmin { get; }
    string? IpAddress { get; }
    string? UserAgent { get; }
}

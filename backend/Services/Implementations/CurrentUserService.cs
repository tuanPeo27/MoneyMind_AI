using backend.Helpers;
using backend.Services.Interfaces;
using Microsoft.IdentityModel.JsonWebTokens;

namespace backend.Services.Implementations;

public sealed class CurrentUserService(IHttpContextAccessor accessor) : ICurrentUserService
{
    private HttpContext? Context => accessor.HttpContext;

    public Guid? UserId =>
        Guid.TryParse(Context?.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var id) ? id : null;

    public Guid RequiredUserId => UserId ?? throw new UnauthorizedAppException();

    public bool IsAdmin => Context?.User.IsInRole(Roles.Admin) ?? false;

    public string? IpAddress => Truncate(Context?.Connection.RemoteIpAddress?.ToString(), 45);

    public string? UserAgent => Truncate(Context?.Request.Headers.UserAgent.ToString(), 500);

    private static string? Truncate(string? value, int max) =>
        string.IsNullOrEmpty(value) ? null : value.Length <= max ? value : value[..max];
}

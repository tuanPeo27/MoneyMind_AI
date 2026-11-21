using backend.Models;

namespace backend.Services.Interfaces;

public interface ITokenService
{
    TimeSpan RefreshTokenLifetime { get; }

    (string Token, DateTime ExpiresAt) CreateAccessToken(ApplicationUser user, IEnumerable<string> roles);

    /// <summary>Creates a new opaque refresh token (plain value, to be hashed before storing).</summary>
    string GenerateRefreshToken();

    string HashToken(string token);
}

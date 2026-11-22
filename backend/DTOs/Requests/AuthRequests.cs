using System.ComponentModel.DataAnnotations;

namespace backend.DTOs.Requests;

public sealed record RegisterRequest(
    [Required, StringLength(100)] string FullName,
    [Required, EmailAddress, StringLength(256)] string Email,
    [Required, StringLength(128, MinimumLength = 8)] string Password);

public sealed record LoginRequest(
    [Required, EmailAddress] string Email,
    [Required] string Password);

/// <param name="IdToken">The Google ID token (JWT) returned by Google Identity Services on the client.</param>
public sealed record GoogleLoginRequest([Required] string IdToken);

public sealed record RefreshTokenRequest([Required] string RefreshToken);

public sealed record LogoutRequest([Required] string RefreshToken);

public sealed record ForgotPasswordRequest([Required, EmailAddress] string Email);

public sealed record ResetPasswordRequest(
    [Required] string Token,
    [Required, StringLength(128, MinimumLength = 8)] string NewPassword);

public sealed record UpdateProfileRequest(
    [Required, StringLength(100)] string FullName,
    [Phone, StringLength(30)] string? PhoneNumber,
    [Url, StringLength(2048)] string? AvatarUrl = null);

public sealed record ChangePasswordRequest(
    [Required] string CurrentPassword,
    [Required, StringLength(128, MinimumLength = 8)] string NewPassword);

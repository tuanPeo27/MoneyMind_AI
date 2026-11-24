using backend.Helpers;
using System.ComponentModel.DataAnnotations;

namespace backend.DTOs.Requests;

public sealed record RegisterRequest(
    [property: Required]
    [property: StringLength(100)]
    string FullName,
    [property: Required]
    [property: EmailAddress]
    [property: StringLength(256)]
    string Email,
    [property: Required]
    [property: StringLength(128, MinimumLength = 8)]
    string Password);

public sealed record LoginRequest(
    [property: Required]
    [property: EmailAddress]
    string Email,
    [property: Required] string Password);

/// <param name="IdToken">The Google ID token (JWT) returned by Google Identity Services on the client.</param>
public sealed record GoogleLoginRequest([property: Required] string IdToken);

public sealed record RefreshTokenRequest([property: Required] string RefreshToken);

public sealed record LogoutRequest([property: Required] string RefreshToken);

public sealed record ForgotPasswordRequest(
    [property: Required]
    [property: EmailAddress]
    string Email);

public sealed record ResetPasswordRequest(
    [property: Required] string Token,
    [property: Required]
    [property: StringLength(128, MinimumLength = 8)]
    string NewPassword);

public sealed record UpdateProfileRequest(
    [property: Required]
    [property: StringLength(100)]
    string FullName,
    [property: ValidPhoneNumber]
    [property: StringLength(30)]
    string? PhoneNumber,
    [property: Url]
    [property: StringLength(2048)]
    string? AvatarUrl = null);

public sealed record UpdateTimeZoneRequest(
    [property: Required]
    [property: StringLength(100)]
    string TimeZoneId);

public sealed record ChangePasswordRequest(
    [property: Required] string CurrentPassword,
    [property: Required]
    [property: StringLength(128, MinimumLength = 8)]
    string NewPassword);

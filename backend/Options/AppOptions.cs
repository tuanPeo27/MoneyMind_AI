using System.ComponentModel.DataAnnotations;

namespace backend.Options;

public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    [Required] public string Issuer { get; set; } = string.Empty;
    [Required] public string Audience { get; set; } = string.Empty;

    /// <summary>HMAC-SHA256 signing key. Supply via user-secrets or environment, never commit it.</summary>
    [Required, MinLength(32)] public string Key { get; set; } = string.Empty;

    [Range(1, 1440)] public int AccessTokenMinutes { get; set; } = 15;
    [Range(1, 365)] public int RefreshTokenDays { get; set; } = 14;
}

public sealed class AppOptions
{
    public const string SectionName = "App";

    /// <summary>Base URL of the web client, used to build password reset links.</summary>
    [Required] public string FrontendUrl { get; set; } = "http://localhost:3000";

    [Range(5, 1440)] public int PasswordResetMinutes { get; set; } = 60;
}

public sealed class SeedOptions
{
    public const string SectionName = "Seed";

    public string AdminEmail { get; set; } = string.Empty;
    public string AdminPassword { get; set; } = string.Empty;
    public string AdminFullName { get; set; } = "System Admin";
}

public sealed class GoogleOptions
{
    public const string SectionName = "Google";

    /// <summary>OAuth Client ID (Web application). It is public, not a secret.</summary>
    public string ClientId { get; set; } = string.Empty;
}

public sealed class SmtpOptions
{
    public const string SectionName = "Smtp";

    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public bool EnableSsl { get; set; } = true;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string FromAddress { get; set; } = "no-reply@moneymind.local";
    public string FromName { get; set; } = "MoneyMind AI";
}

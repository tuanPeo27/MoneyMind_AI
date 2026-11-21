using System.Security.Cryptography;
using System.Text;

namespace backend.Helpers;

public static class SecurityHelper
{
    public static string GenerateToken(int bytes = 64) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string Sha256(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}

public static class Roles
{
    public const string Admin = "Admin";
    public const string User = "User";
}

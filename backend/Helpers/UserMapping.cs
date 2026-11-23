using backend.DTOs.Responses;
using backend.Models;
using Microsoft.AspNetCore.Identity;

namespace backend.Helpers;

public static class UserMapping
{
    public static UserResponse ToResponse(this ApplicationUser user, IEnumerable<string> roles) =>
        new(user.Id, user.FullName, user.Email ?? string.Empty, user.PhoneNumber, user.AvatarUrl, roles.ToList(),
            user.CreatedAt, user.LastLoginAt, user.HasPassword());

    /// <summary>False for accounts created through Google sign-in, which have no local password.</summary>
    public static bool HasPassword(this ApplicationUser user) => !string.IsNullOrEmpty(user.PasswordHash);

    public static string Describe(this IdentityResult result) =>
        string.Join(" ", result.Errors.Select(error => error.Description));
}

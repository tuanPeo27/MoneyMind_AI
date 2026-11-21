using backend.DTOs.Responses;
using backend.Models;
using Microsoft.AspNetCore.Identity;

namespace backend.Helpers;

public static class UserMapping
{
    public static UserResponse ToResponse(this ApplicationUser user, IEnumerable<string> roles) =>
        new(user.Id, user.FullName, user.Email ?? string.Empty, user.PhoneNumber, roles.ToList(),
            user.CreatedAt, user.LastLoginAt);

    public static string Describe(this IdentityResult result) =>
        string.Join(" ", result.Errors.Select(error => error.Description));
}

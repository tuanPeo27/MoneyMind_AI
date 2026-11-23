using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class UserService(UserManager<ApplicationUser> userManager, AppDbContext db) : IUserService
{
    public async Task<UserResponse> GetProfileAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await FindAsync(userId);
        return user.ToResponse(await userManager.GetRolesAsync(user));
    }

    public async Task<UserResponse> UpdateProfileAsync(Guid userId, UpdateProfileRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await FindAsync(userId);
        user.FullName = request.FullName.Trim();
        user.PhoneNumber = string.IsNullOrWhiteSpace(request.PhoneNumber) ? null : request.PhoneNumber.Trim();
        user.AvatarUrl = NormalizeAvatarUrl(request.AvatarUrl);
        user.UpdatedAt = DateTime.UtcNow;

        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) throw new BadRequestException(result.Describe());

        return user.ToResponse(await userManager.GetRolesAsync(user));
    }

    public async Task<UserResponse> UpdateTimeZoneAsync(Guid userId, UpdateTimeZoneRequest request,
        CancellationToken cancellationToken = default)
    {
        var timeZoneId = request.TimeZoneId.Trim();
        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            throw new BadRequestException("Múi giờ không hợp lệ.");
        }
        catch (InvalidTimeZoneException)
        {
            throw new BadRequestException("Múi giờ không hợp lệ.");
        }

        var user = await FindAsync(userId);
        user.TimeZoneId = timeZoneId;
        user.UpdatedAt = DateTime.UtcNow;
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) throw new BadRequestException(result.Describe());
        return user.ToResponse(await userManager.GetRolesAsync(user));
    }

    public async Task ChangePasswordAsync(Guid userId, ChangePasswordRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.CurrentPassword == request.NewPassword)
            throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");

        var user = await FindAsync(userId);
        if (!user.HasPassword())
            throw new BadRequestException("Tài khoản đăng nhập bằng Google không có mật khẩu để đổi.");

        var result = await userManager.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded) throw new BadRequestException(result.Describe());

        // End every session so tokens issued under the old password stop working.
        var now = DateTime.UtcNow;
        await db.RefreshTokens
            .Where(token => token.UserId == userId && token.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(token => token.RevokedAt, now), cancellationToken);
    }

    /// <summary>Empty clears the avatar. Only absolute http/https URLs are accepted.</summary>
    private static string? NormalizeAvatarUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;

        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new BadRequestException("Avatar URL phải là địa chỉ http hoặc https hợp lệ.");

        return uri.AbsoluteUri;
    }

    private async Task<ApplicationUser> FindAsync(Guid userId)
    {
        var user = await userManager.FindByIdAsync(userId.ToString())
            ?? throw new NotFoundException("Không tìm thấy người dùng.");
        if (!user.IsActive) throw new ForbiddenException("Tài khoản đã bị khóa.");
        return user;
    }
}

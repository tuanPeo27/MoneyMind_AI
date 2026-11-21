using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Options;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services.Implementations;

public sealed class AuthService(
    UserManager<ApplicationUser> userManager,
    RoleManager<IdentityRole<Guid>> roleManager,
    AppDbContext db,
    ITokenService tokenService,
    IEmailService emailService,
    ICurrentUserService currentUser,
    IOptions<AppOptions> appOptions,
    ILogger<AuthService> logger) : IAuthService
{
    private const string InvalidCredentials = "Email hoặc mật khẩu không đúng.";
    private const string InvalidResetToken = "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.";

    public async Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default)
    {
        var email = NormalizeEmail(request.Email);
        if (await userManager.FindByEmailAsync(email) is not null)
            throw new ConflictException("Email đã được sử dụng.");

        var user = new ApplicationUser
        {
            FullName = request.FullName.Trim(),
            Email = email,
            UserName = email
        };

        var created = await userManager.CreateAsync(user, request.Password);
        if (!created.Succeeded) throw new BadRequestException(created.Describe());

        if (!await roleManager.RoleExistsAsync(Roles.User))
            await roleManager.CreateAsync(new IdentityRole<Guid>(Roles.User));

        var roleResult = await userManager.AddToRoleAsync(user, Roles.User);
        if (!roleResult.Succeeded)
        {
            await userManager.DeleteAsync(user);
            logger.LogError("Could not assign role to new user: {Errors}", roleResult.Describe());
            throw new InvalidOperationException("Could not complete registration.");
        }

        user.LastLoginAt = DateTime.UtcNow;
        await userManager.UpdateAsync(user);
        return await IssueTokensAsync(user, cancellationToken);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var user = await userManager.FindByEmailAsync(NormalizeEmail(request.Email))
            ?? throw new UnauthorizedAppException(InvalidCredentials);

        if (await userManager.IsLockedOutAsync(user))
            throw new ForbiddenException("Tài khoản tạm thời bị khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau.");

        if (!await userManager.CheckPasswordAsync(user, request.Password))
        {
            await userManager.AccessFailedAsync(user);
            throw new UnauthorizedAppException(InvalidCredentials);
        }

        EnsureActive(user);

        await userManager.ResetAccessFailedCountAsync(user);
        user.LastLoginAt = DateTime.UtcNow;
        await userManager.UpdateAsync(user);
        return await IssueTokensAsync(user, cancellationToken);
    }

    public async Task<AuthResponse> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default)
    {
        var hash = tokenService.HashToken(request.RefreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(token => token.TokenHash == hash, cancellationToken)
            ?? throw new UnauthorizedAppException("Refresh token không hợp lệ.");

        if (stored.RevokedAt is not null)
        {
            // A revoked token was presented again: assume theft and end every session of that user.
            await RevokeAllAsync(stored.UserId, cancellationToken);
            throw new UnauthorizedAppException("Refresh token không hợp lệ.");
        }

        if (stored.ExpiresAt <= DateTime.UtcNow)
            throw new UnauthorizedAppException("Phiên đăng nhập đã hết hạn.");

        var user = await userManager.FindByIdAsync(stored.UserId.ToString())
            ?? throw new UnauthorizedAppException("Refresh token không hợp lệ.");
        EnsureActive(user);

        stored.RevokedAt = DateTime.UtcNow;
        return await IssueTokensAsync(user, cancellationToken);
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        var hash = tokenService.HashToken(refreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(token => token.TokenHash == hash, cancellationToken);
        if (stored is null || stored.RevokedAt is not null) return;

        stored.RevokedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    public Task LogoutAllAsync(Guid userId, CancellationToken cancellationToken = default) =>
        RevokeAllAsync(userId, cancellationToken);

    public async Task ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken cancellationToken = default)
    {
        // Always completes silently so callers cannot discover which emails are registered.
        var user = await userManager.FindByEmailAsync(NormalizeEmail(request.Email));
        if (user is null || !user.IsActive) return;

        var now = DateTime.UtcNow;
        var pending = await db.PasswordResetTokens
            .Where(token => token.UserId == user.Id && token.UsedAt == null && token.ExpiresAt > now)
            .ToListAsync(cancellationToken);
        foreach (var old in pending) old.UsedAt = now;

        var plainToken = SecurityHelper.GenerateToken(48);
        db.PasswordResetTokens.Add(new PasswordResetToken
        {
            UserId = user.Id,
            TokenHash = tokenService.HashToken(plainToken),
            ExpiresAt = now.AddMinutes(appOptions.Value.PasswordResetMinutes)
        });
        await db.SaveChangesAsync(cancellationToken);

        try
        {
            await emailService.SendPasswordResetAsync(user.Email!, user.FullName, plainToken, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Failed to send password reset email to user {UserId}", user.Id);
        }
    }

    public async Task ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken = default)
    {
        var hash = tokenService.HashToken(request.Token);
        var stored = await db.PasswordResetTokens.FirstOrDefaultAsync(token => token.TokenHash == hash, cancellationToken);
        if (stored is null || stored.UsedAt is not null || stored.ExpiresAt <= DateTime.UtcNow)
            throw new BadRequestException(InvalidResetToken);

        var user = await userManager.FindByIdAsync(stored.UserId.ToString());
        if (user is null || !user.IsActive) throw new BadRequestException(InvalidResetToken);

        var identityToken = await userManager.GeneratePasswordResetTokenAsync(user);
        var result = await userManager.ResetPasswordAsync(user, identityToken, request.NewPassword);
        if (!result.Succeeded) throw new BadRequestException(result.Describe());

        // Save explicitly: the helpers below may not call SaveChanges, which would leave the token reusable.
        stored.UsedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        await userManager.ResetAccessFailedCountAsync(user);
        await userManager.SetLockoutEndDateAsync(user, null);
        await RevokeAllAsync(user.Id, cancellationToken);
    }

    public async Task<IReadOnlyList<SessionResponse>> GetSessionsAsync(Guid userId,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        return await db.RefreshTokens.AsNoTracking()
            .Where(token => token.UserId == userId && token.RevokedAt == null && token.ExpiresAt > now)
            .OrderByDescending(token => token.CreatedAt)
            .Select(token => new SessionResponse(token.Id, token.DeviceInfo, token.IpAddress, token.CreatedAt,
                token.ExpiresAt))
            .ToListAsync(cancellationToken);
    }

    public async Task RevokeSessionAsync(Guid userId, Guid sessionId, CancellationToken cancellationToken = default)
    {
        var stored = await db.RefreshTokens
            .FirstOrDefaultAsync(token => token.Id == sessionId && token.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy phiên đăng nhập.");

        if (stored.RevokedAt is not null) return;
        stored.RevokedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private static void EnsureActive(ApplicationUser user)
    {
        if (!user.IsActive) throw new ForbiddenException("Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.");
    }

    private async Task RevokeAllAsync(Guid userId, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        await db.RefreshTokens
            .Where(token => token.UserId == userId && token.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(token => token.RevokedAt, now), cancellationToken);
    }

    /// <summary>Creates tokens for the user and saves pending changes (e.g. a rotated refresh token).</summary>
    private async Task<AuthResponse> IssueTokensAsync(ApplicationUser user, CancellationToken cancellationToken)
    {
        var roles = await userManager.GetRolesAsync(user);
        var (accessToken, accessExpires) = tokenService.CreateAccessToken(user, roles);
        var refreshToken = tokenService.GenerateRefreshToken();

        db.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = tokenService.HashToken(refreshToken),
            DeviceInfo = currentUser.UserAgent,
            IpAddress = currentUser.IpAddress,
            ExpiresAt = DateTime.UtcNow.Add(tokenService.RefreshTokenLifetime)
        });

        // Drop this user's tokens that expired or were revoked more than 30 days ago.
        var cutoff = DateTime.UtcNow.AddDays(-30);
        await db.RefreshTokens
            .Where(token => token.UserId == user.Id && (token.ExpiresAt < cutoff || token.RevokedAt < cutoff))
            .ExecuteDeleteAsync(cancellationToken);

        await db.SaveChangesAsync(cancellationToken);
        return new AuthResponse(accessToken, refreshToken, accessExpires, user.ToResponse(roles));
    }
}

using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class AdminUserService(
    AppDbContext db,
    UserManager<ApplicationUser> userManager,
    ICurrentUserService currentUser,
    IAuditService audit) : IAdminUserService
{
    public async Task<PagedResult<AdminUserResponse>> GetPagedAsync(AdminUserQuery query,
        CancellationToken cancellationToken = default)
    {
        var source = db.Users.AsNoTracking().AsQueryable();
        if (query.IsActive is { } isActive) source = source.Where(u => u.IsActive == isActive);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var search = query.Search.Trim();
            source = source.Where(u => u.FullName.Contains(search) || (u.Email != null && u.Email.Contains(search)));
        }

        var total = await source.CountAsync(cancellationToken);
        var users = await source
            .OrderByDescending(u => u.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .ToListAsync(cancellationToken);

        var ids = users.Select(u => u.Id).ToList();
        var roleRows = await (from ur in db.UserRoles
                              join r in db.Roles on ur.RoleId equals r.Id
                              where ids.Contains(ur.UserId)
                              select new { ur.UserId, r.Name })
            .ToListAsync(cancellationToken);
        var rolesByUser = roleRows
            .GroupBy(x => x.UserId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(x => x.Name!).ToList());

        var items = users
            .Select(u => Map(u, rolesByUser.GetValueOrDefault(u.Id) ?? []))
            .ToList();
        return new PagedResult<AdminUserResponse>(items, query.Page, query.PageSize, total);
    }

    public async Task<AdminUserResponse> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var user = await FindAsync(id);
        return Map(user, await userManager.GetRolesAsync(user));
    }

    public async Task<AdminUserResponse> LockAsync(Guid id, LockUserRequest request,
        CancellationToken cancellationToken = default)
    {
        if (id == currentUser.RequiredUserId)
            throw new BadRequestException("Không thể khóa chính tài khoản của bạn.");

        var user = await FindAsync(id);
        var roles = await userManager.GetRolesAsync(user);
        if (roles.Contains(Roles.Admin))
            throw new ForbiddenException("Không thể khóa tài khoản quản trị viên.");
        if (!user.IsActive)
            throw new ConflictException("Tài khoản đã bị khóa.");

        var now = DateTime.UtcNow;
        user.IsActive = false;
        user.LockedAt = now;
        user.LockedReason = request.Reason.Trim();
        user.UpdatedAt = now;
        await SaveAsync(user);

        // End all sessions. Access tokens already issued stay valid until they expire.
        await db.RefreshTokens
            .Where(t => t.UserId == id && t.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(t => t.RevokedAt, now), cancellationToken);

        await audit.LogAsync("LockUser", "User", id, user.LockedReason, cancellationToken);
        return Map(user, roles);
    }

    public async Task<AdminUserResponse> UnlockAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var user = await FindAsync(id);
        var roles = await userManager.GetRolesAsync(user);
        if (user.IsActive) return Map(user, roles);

        user.IsActive = true;
        user.LockedAt = null;
        user.LockedReason = null;
        user.UpdatedAt = DateTime.UtcNow;
        await SaveAsync(user);

        // Also clear a login-attempt lockout so the user can sign in right away.
        await userManager.SetLockoutEndDateAsync(user, null);
        await userManager.ResetAccessFailedCountAsync(user);

        await audit.LogAsync("UnlockUser", "User", id, null, cancellationToken);
        return Map(user, roles);
    }

    private async Task<ApplicationUser> FindAsync(Guid id) =>
        await userManager.FindByIdAsync(id.ToString())
        ?? throw new NotFoundException("Không tìm thấy người dùng.");

    private async Task SaveAsync(ApplicationUser user)
    {
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) throw new BadRequestException(result.Describe());
    }

    private static AdminUserResponse Map(ApplicationUser u, IEnumerable<string> roles) =>
        new(u.Id, u.FullName, u.Email ?? string.Empty, u.AvatarUrl, u.IsActive, u.LockedAt, u.LockedReason, u.LastLoginAt,
            u.CreatedAt, roles.ToList());
}

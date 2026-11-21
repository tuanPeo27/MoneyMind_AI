using System.Text.RegularExpressions;
using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed partial class SystemSettingService(
    AppDbContext db,
    ICurrentUserService currentUser,
    IAuditService audit) : ISystemSettingService
{
    [GeneratedRegex("^[A-Za-z0-9_.:-]{1,100}$")]
    private static partial Regex KeyPattern();

    public async Task<IReadOnlyList<SystemSettingResponse>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.SystemSettings.AsNoTracking()
            .OrderBy(s => s.Key)
            .Select(s => new SystemSettingResponse(s.Key, s.Value, s.Description, s.UpdatedBy, s.UpdatedAt))
            .ToListAsync(cancellationToken);

    public async Task<SystemSettingResponse> GetAsync(string key, CancellationToken cancellationToken = default)
    {
        var setting = await db.SystemSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy cấu hình.");
        return Map(setting);
    }

    public async Task<SystemSettingResponse> UpsertAsync(string key, UpsertSettingRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!KeyPattern().IsMatch(key))
            throw new BadRequestException("Key chỉ gồm chữ, số và các ký tự _ . : - (tối đa 100 ký tự).");

        var adminId = currentUser.RequiredUserId;
        var adminEmail = await db.Users.Where(u => u.Id == adminId).Select(u => u.Email)
            .FirstOrDefaultAsync(cancellationToken);

        var setting = await db.SystemSettings.FirstOrDefaultAsync(s => s.Key == key, cancellationToken);
        var isNew = setting is null;
        if (setting is null)
        {
            setting = new SystemSetting { Key = key };
            db.SystemSettings.Add(setting);
        }

        setting.Value = request.Value;
        if (request.Description is not null) setting.Description = request.Description;
        setting.UpdatedBy = adminEmail ?? adminId.ToString();
        setting.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        // The value is not logged: settings may hold secrets.
        await audit.LogAsync(isNew ? "CreateSetting" : "UpdateSetting", "SystemSetting", null, $"key={key}",
            cancellationToken);
        return Map(setting);
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken = default)
    {
        var deleted = await db.SystemSettings.Where(s => s.Key == key).ExecuteDeleteAsync(cancellationToken);
        if (deleted == 0) throw new NotFoundException("Không tìm thấy cấu hình.");

        await audit.LogAsync("DeleteSetting", "SystemSetting", null, $"key={key}", cancellationToken);
    }

    private static SystemSettingResponse Map(SystemSetting s) =>
        new(s.Key, s.Value, s.Description, s.UpdatedBy, s.UpdatedAt);
}

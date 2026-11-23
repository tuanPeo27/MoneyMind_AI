using backend.Helpers;
using backend.Models;
using backend.Options;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Data;

/// <summary>
/// Seeds the roles, the admin account and the default (system) categories.
/// Safe to run on every start: existing data is never modified or duplicated.
/// </summary>
public static class DbSeeder
{
    private sealed record CategorySeed(string Name, CategoryType Type, string Icon, string Color);

    private static readonly CategorySeed[] DefaultCategories =
    [
        // Expense
        new("Ăn uống", CategoryType.Expense, "utensils", "#F97316"),
        new("Di chuyển", CategoryType.Expense, "car", "#3B82F6"),
        new("Nhà ở", CategoryType.Expense, "home", "#8B5CF6"),
        new("Hóa đơn & tiện ích", CategoryType.Expense, "receipt", "#EAB308"),
        new("Mua sắm", CategoryType.Expense, "shopping-bag", "#EC4899"),
        new("Giải trí", CategoryType.Expense, "gamepad-2", "#14B8A6"),
        new("Sức khỏe", CategoryType.Expense, "heart-pulse", "#EF4444"),
        new("Giáo dục", CategoryType.Expense, "graduation-cap", "#6366F1"),
        new("Du lịch", CategoryType.Expense, "plane", "#06B6D4"),
        new("Quà tặng & từ thiện", CategoryType.Expense, "gift", "#F43F5E"),
        new("Chi tiêu khác", CategoryType.Expense, "ellipsis", "#6B7280"),

        // Income
        new("Lương", CategoryType.Income, "wallet", "#22C55E"),
        new("Thưởng", CategoryType.Income, "award", "#84CC16"),
        new("Đầu tư", CategoryType.Income, "trending-up", "#10B981"),
        new("Kinh doanh", CategoryType.Income, "briefcase", "#0EA5E9"),
        new("Được tặng", CategoryType.Income, "gift", "#F472B6"),
        new("Thu nhập khác", CategoryType.Income, "ellipsis", "#6B7280")
    ];

    public static async Task SeedAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        using var scope = services.CreateScope();
        var provider = scope.ServiceProvider;
        var logger = provider.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(DbSeeder));

        await SeedRolesAsync(provider.GetRequiredService<RoleManager<IdentityRole<Guid>>>());
        await SeedAdminAsync(
            provider.GetRequiredService<UserManager<ApplicationUser>>(),
            provider.GetRequiredService<IOptions<SeedOptions>>().Value,
            logger);
        await SeedCategoriesAsync(provider.GetRequiredService<AppDbContext>(), logger, cancellationToken);
        await SeedSettingsAsync(provider.GetRequiredService<AppDbContext>(), cancellationToken);
    }

    private static async Task SeedRolesAsync(RoleManager<IdentityRole<Guid>> roleManager)
    {
        foreach (var role in new[] { Roles.Admin, Roles.User })
        {
            if (await roleManager.RoleExistsAsync(role)) continue;

            var result = await roleManager.CreateAsync(new IdentityRole<Guid>(role));
            if (!result.Succeeded)
                throw new InvalidOperationException($"Could not create role '{role}': {result.Describe()}");
        }
    }

    private static async Task SeedAdminAsync(UserManager<ApplicationUser> userManager, SeedOptions options,
        ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(options.AdminEmail) || string.IsNullOrWhiteSpace(options.AdminPassword))
        {
            logger.LogWarning("Seed:AdminEmail / Seed:AdminPassword not configured. Admin account was not created.");
            return;
        }

        var email = options.AdminEmail.Trim().ToLowerInvariant();
        var admin = await userManager.FindByEmailAsync(email);

        if (admin is null)
        {
            admin = new ApplicationUser
            {
                FullName = options.AdminFullName,
                Email = email,
                UserName = email,
                EmailConfirmed = true
            };

            var created = await userManager.CreateAsync(admin, options.AdminPassword);
            if (!created.Succeeded)
                throw new InvalidOperationException($"Could not create admin account: {created.Describe()}");

            logger.LogInformation("Seeded admin account {Email}.", email);
        }

        if (!await userManager.IsInRoleAsync(admin, Roles.Admin))
        {
            var added = await userManager.AddToRoleAsync(admin, Roles.Admin);
            if (!added.Succeeded)
                throw new InvalidOperationException($"Could not assign Admin role: {added.Describe()}");
        }
    }

    /// <summary>Creates the default AI message limit once. An admin can change it; it is never overwritten.</summary>
    private static async Task SeedSettingsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        if (await db.SystemSettings.AnyAsync(setting => setting.Key == AIQuota.DefaultSettingKey, cancellationToken)) return;

        db.SystemSettings.Add(new SystemSetting
        {
            Key = AIQuota.DefaultSettingKey,
            Value = AIQuota.FallbackDefault.ToString(),
            Description = "AI chat messages per user per day when an admin has not set a limit for that user. -1 means unlimited.",
            UpdatedBy = "system"
        });
        await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedCategoriesAsync(AppDbContext db, ILogger logger, CancellationToken cancellationToken)
    {
        var existing = await db.Categories
            .Where(category => category.IsSystem)
            .Select(category => new { category.Name, category.Type })
            .ToListAsync(cancellationToken);

        var missing = DefaultCategories
            .Where(seed => !existing.Any(e => e.Type == seed.Type
                && string.Equals(e.Name, seed.Name, StringComparison.OrdinalIgnoreCase)))
            .Select(seed => new Category
            {
                UserId = null,
                Name = seed.Name,
                Type = seed.Type,
                Icon = seed.Icon,
                Color = seed.Color,
                IsSystem = true,
                IsActive = true
            })
            .ToList();

        if (missing.Count == 0) return;

        db.Categories.AddRange(missing);
        await db.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Seeded {Count} default categories.", missing.Count);
    }
}

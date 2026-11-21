using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class CategoryService(AppDbContext db, IAuditService audit) : ICategoryService
{
    public async Task<IReadOnlyList<CategoryResponse>> GetForUserAsync(Guid userId, CategoryType? type = null,
        CancellationToken cancellationToken = default)
    {
        var query = db.Categories.AsNoTracking()
            .Where(c => (c.IsSystem && c.IsActive) || c.UserId == userId);
        if (type is not null) query = query.Where(c => c.Type == type);

        var items = await query.OrderBy(c => c.Type).ThenBy(c => c.Name).ToListAsync(cancellationToken);
        return items.Select(Map).ToList();
    }

    public async Task<CategoryResponse> GetByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var category = await db.Categories.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id && (c.IsSystem || c.UserId == userId), cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy danh mục.");
        return Map(category);
    }

    public async Task<CategoryResponse> CreateAsync(Guid userId, UpsertCategoryRequest request,
        CancellationToken cancellationToken = default)
    {
        var name = request.Name.Trim();
        var duplicate = await db.Categories.AnyAsync(
            c => (c.IsSystem || c.UserId == userId) && c.Type == request.Type && c.Name == name, cancellationToken);
        if (duplicate) throw new ConflictException("Danh mục đã tồn tại.");

        var category = new Category
        {
            UserId = userId,
            Name = name,
            Type = request.Type,
            Icon = request.Icon,
            Color = request.Color,
            IsSystem = false,
            IsActive = request.IsActive
        };
        db.Categories.Add(category);
        await db.SaveChangesAsync(cancellationToken);
        return Map(category);
    }

    public async Task<CategoryResponse> UpdateAsync(Guid userId, Guid id, UpsertCategoryRequest request,
        CancellationToken cancellationToken = default)
    {
        var category = await db.Categories
            .FirstOrDefaultAsync(c => c.Id == id && (c.IsSystem || c.UserId == userId), cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy danh mục.");
        if (category.IsSystem) throw new ForbiddenException("Không thể sửa danh mục mặc định.");

        var name = request.Name.Trim();
        var duplicate = await db.Categories.AnyAsync(
            c => c.Id != id && (c.IsSystem || c.UserId == userId) && c.Type == request.Type && c.Name == name,
            cancellationToken);
        if (duplicate) throw new ConflictException("Danh mục đã tồn tại.");

        await ApplyAsync(category, request, name, cancellationToken);
        return Map(category);
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var category = await db.Categories
            .FirstOrDefaultAsync(c => c.Id == id && (c.IsSystem || c.UserId == userId), cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy danh mục.");
        if (category.IsSystem) throw new ForbiddenException("Không thể xóa danh mục mặc định.");

        await RemoveOrDeactivateAsync(category, cancellationToken);
    }

    // ---- Admin: system categories ----

    public async Task<IReadOnlyList<CategoryResponse>> GetSystemCategoriesAsync(
        CancellationToken cancellationToken = default)
    {
        var items = await db.Categories.AsNoTracking()
            .Where(c => c.IsSystem)
            .OrderBy(c => c.Type).ThenBy(c => c.Name)
            .ToListAsync(cancellationToken);
        return items.Select(Map).ToList();
    }

    public async Task<CategoryResponse> CreateSystemCategoryAsync(UpsertCategoryRequest request,
        CancellationToken cancellationToken = default)
    {
        var name = request.Name.Trim();
        var duplicate = await db.Categories.AnyAsync(
            c => c.IsSystem && c.Type == request.Type && c.Name == name, cancellationToken);
        if (duplicate) throw new ConflictException("Danh mục mặc định đã tồn tại.");

        var category = new Category
        {
            UserId = null,
            Name = name,
            Type = request.Type,
            Icon = request.Icon,
            Color = request.Color,
            IsSystem = true,
            IsActive = request.IsActive
        };
        db.Categories.Add(category);
        await db.SaveChangesAsync(cancellationToken);

        await audit.LogAsync("CreateSystemCategory", "Category", category.Id, $"{category.Type}: {category.Name}",
            cancellationToken);
        return Map(category);
    }

    public async Task<CategoryResponse> UpdateSystemCategoryAsync(Guid id, UpsertCategoryRequest request,
        CancellationToken cancellationToken = default)
    {
        var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.IsSystem, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy danh mục mặc định.");

        var name = request.Name.Trim();
        var duplicate = await db.Categories.AnyAsync(
            c => c.Id != id && c.IsSystem && c.Type == request.Type && c.Name == name, cancellationToken);
        if (duplicate) throw new ConflictException("Danh mục mặc định đã tồn tại.");

        await ApplyAsync(category, request, name, cancellationToken);
        await audit.LogAsync("UpdateSystemCategory", "Category", id, $"{category.Type}: {category.Name}",
            cancellationToken);
        return Map(category);
    }

    public async Task DeleteSystemCategoryAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.IsSystem, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy danh mục mặc định.");
        await RemoveOrDeactivateAsync(category, cancellationToken);
        await audit.LogAsync("DeleteSystemCategory", "Category", id, category.Name, cancellationToken);
    }

    // ---- helpers ----

    private async Task ApplyAsync(Category category, UpsertCategoryRequest request, string name,
        CancellationToken cancellationToken)
    {
        if (request.Type != category.Type && await IsInUseAsync(category.Id, cancellationToken))
            throw new ConflictException("Danh mục đã được sử dụng, không thể đổi loại.");

        category.Name = name;
        category.Type = request.Type;
        category.Icon = request.Icon;
        category.Color = request.Color;
        category.IsActive = request.IsActive;
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Deletes an unused category; deactivates one that transactions or budgets still reference.</summary>
    private async Task RemoveOrDeactivateAsync(Category category, CancellationToken cancellationToken)
    {
        if (await IsInUseAsync(category.Id, cancellationToken)) category.IsActive = false;
        else db.Categories.Remove(category);

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task<bool> IsInUseAsync(Guid categoryId, CancellationToken cancellationToken) =>
        await db.Transactions.AnyAsync(t => t.CategoryId == categoryId, cancellationToken)
        || await db.Budgets.AnyAsync(b => b.CategoryId == categoryId, cancellationToken)
        || await db.CategorySuggestionLogs.AnyAsync(
            l => l.SuggestedCategoryId == categoryId || l.FinalCategoryId == categoryId, cancellationToken);

    private static CategoryResponse Map(Category c) =>
        new(c.Id, c.Name, c.Type, c.Icon, c.Color, c.IsSystem, c.IsActive);
}

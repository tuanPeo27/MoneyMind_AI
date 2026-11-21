using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Models;

namespace backend.Services.Interfaces;

public interface ICategoryService
{
    /// <summary>System categories plus the user's own categories.</summary>
    Task<IReadOnlyList<CategoryResponse>> GetForUserAsync(Guid userId, CategoryType? type = null,
        CancellationToken cancellationToken = default);
    Task<CategoryResponse> GetByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
    Task<CategoryResponse> CreateAsync(Guid userId, UpsertCategoryRequest request,
        CancellationToken cancellationToken = default);
    Task<CategoryResponse> UpdateAsync(Guid userId, Guid id, UpsertCategoryRequest request,
        CancellationToken cancellationToken = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);

    // Admin: default (system) categories.
    Task<IReadOnlyList<CategoryResponse>> GetSystemCategoriesAsync(CancellationToken cancellationToken = default);
    Task<CategoryResponse> CreateSystemCategoryAsync(UpsertCategoryRequest request,
        CancellationToken cancellationToken = default);
    Task<CategoryResponse> UpdateSystemCategoryAsync(Guid id, UpsertCategoryRequest request,
        CancellationToken cancellationToken = default);
    Task DeleteSystemCategoryAsync(Guid id, CancellationToken cancellationToken = default);
}

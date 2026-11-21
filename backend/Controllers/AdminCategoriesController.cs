using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

/// <summary>Default (system) categories shared by all users.</summary>
[Route("api/admin/categories")]
public sealed class AdminCategoriesController(ICategoryService service) : AdminControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<CategoryResponse>>> GetAll(CancellationToken ct) =>
        Ok(await service.GetSystemCategoriesAsync(ct));

    [HttpPost]
    public async Task<ActionResult<CategoryResponse>> Create(UpsertCategoryRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await service.CreateSystemCategoryAsync(request, ct));

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<CategoryResponse>> Update(Guid id, UpsertCategoryRequest request,
        CancellationToken ct) =>
        Ok(await service.UpdateSystemCategoryAsync(id, request, ct));

    /// <summary>Deletes the category, or deactivates it when transactions or budgets still use it.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteSystemCategoryAsync(id, ct);
        return NoContent();
    }
}

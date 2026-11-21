using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/categories")]
public sealed class CategoriesController(ICategoryService service, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<CategoryResponse>>> GetAll(
        [FromQuery] CategoryType? type, CancellationToken ct) =>
        Ok(await service.GetForUserAsync(UserId, type, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<CategoryResponse>> GetById(Guid id, CancellationToken ct) =>
        Ok(await service.GetByIdAsync(UserId, id, ct));

    [HttpPost]
    public async Task<ActionResult<CategoryResponse>> Create(UpsertCategoryRequest request, CancellationToken ct)
    {
        var created = await service.CreateAsync(UserId, request, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<CategoryResponse>> Update(Guid id, UpsertCategoryRequest request,
        CancellationToken ct) =>
        Ok(await service.UpdateAsync(UserId, id, request, ct));

    /// <summary>Deletes the category, or deactivates it when transactions or budgets still use it.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteAsync(UserId, id, ct);
        return NoContent();
    }
}

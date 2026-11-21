using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/budgets")]
public sealed class BudgetsController(IBudgetService service, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    /// <param name="activeOn">When set, only budgets covering this date are returned.</param>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<BudgetResponse>>> GetAll(
        [FromQuery] DateOnly? activeOn, CancellationToken ct) =>
        Ok(await service.GetAllAsync(UserId, activeOn, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<BudgetResponse>> GetById(Guid id, CancellationToken ct) =>
        Ok(await service.GetByIdAsync(UserId, id, ct));

    [HttpPost]
    public async Task<ActionResult<BudgetResponse>> Create(UpsertBudgetRequest request, CancellationToken ct)
    {
        var created = await service.CreateAsync(UserId, request, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<BudgetResponse>> Update(Guid id, UpsertBudgetRequest request,
        CancellationToken ct) =>
        Ok(await service.UpdateAsync(UserId, id, request, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteAsync(UserId, id, ct);
        return NoContent();
    }
}

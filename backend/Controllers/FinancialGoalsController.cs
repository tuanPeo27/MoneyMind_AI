using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/financial-goals")]
public sealed class FinancialGoalsController(IFinancialGoalService service, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<FinancialGoalResponse>>> GetAll(
        [FromQuery] FinancialGoalStatus? status, CancellationToken ct) =>
        Ok(await service.GetAllAsync(UserId, status, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<FinancialGoalResponse>> GetById(Guid id, CancellationToken ct) =>
        Ok(await service.GetByIdAsync(UserId, id, ct));

    [HttpPost]
    public async Task<ActionResult<FinancialGoalResponse>> Create(UpsertGoalRequest request, CancellationToken ct)
    {
        var created = await service.CreateAsync(UserId, request, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<FinancialGoalResponse>> Update(Guid id, UpsertGoalRequest request,
        CancellationToken ct) =>
        Ok(await service.UpdateAsync(UserId, id, request, ct));

    /// <summary>Adds an amount to the saved total. The goal completes when the target is reached.</summary>
    [HttpPost("{id:guid}/contributions")]
    public async Task<ActionResult<FinancialGoalResponse>> Contribute(Guid id, GoalContributionRequest request,
        CancellationToken ct) =>
        Ok(await service.ContributeAsync(UserId, id, request, ct));

    [HttpPut("{id:guid}/status")]
    public async Task<ActionResult<FinancialGoalResponse>> UpdateStatus(Guid id, UpdateGoalStatusRequest request,
        CancellationToken ct) =>
        Ok(await service.UpdateStatusAsync(UserId, id, request, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteAsync(UserId, id, ct);
        return NoContent();
    }
}

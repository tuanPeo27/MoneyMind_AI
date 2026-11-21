using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/transactions")]
public sealed class TransactionsController(ITransactionService service, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<TransactionResponse>>> GetPaged(
        [FromQuery] TransactionQuery query, CancellationToken ct) =>
        Ok(await service.GetPagedAsync(UserId, query, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<TransactionResponse>> GetById(Guid id, CancellationToken ct) =>
        Ok(await service.GetByIdAsync(UserId, id, ct));

    [HttpPost]
    public async Task<ActionResult<TransactionResponse>> Create(UpsertTransactionRequest request,
        CancellationToken ct)
    {
        var created = await service.CreateAsync(UserId, request, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<TransactionResponse>> Update(Guid id, UpsertTransactionRequest request,
        CancellationToken ct) =>
        Ok(await service.UpdateAsync(UserId, id, request, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteAsync(UserId, id, ct);
        return NoContent();
    }
}

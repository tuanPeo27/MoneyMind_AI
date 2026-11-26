using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace backend.Controllers;

[Route("api/transactions")]
public sealed class TransactionsController(ITransactionService service, ITransactionCategorizationService categorization,
    ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<TransactionResponse>>> GetPaged(
        [FromQuery] TransactionQuery query, CancellationToken ct) =>
        Ok(await service.GetPagedAsync(UserId, query, ct));

    /// <summary>
    /// Category for a description: the user's history, then keyword rules, then AI (limited per day). Method is
    /// History, Rule, AI or None. LogId is set for AI suggestions; send the final choice to the confirm endpoint.
    /// </summary>
    [HttpPost("suggest-category")]
    [EnableRateLimiting("ai")]
    public async Task<ActionResult<CategorySuggestionResponse>> SuggestCategory(SuggestCategoryRequest request,
        CancellationToken ct) =>
        Ok(await categorization.SuggestAsync(UserId, request, ct));

    [HttpPost("category-suggestions/{logId:guid}/confirm")]
    public async Task<IActionResult> ConfirmCategorySuggestion(Guid logId, ConfirmCategorySuggestionRequest request,
        CancellationToken ct)
    {
        await categorization.ConfirmAsync(UserId, logId, request, ct);
        return NoContent();
    }

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

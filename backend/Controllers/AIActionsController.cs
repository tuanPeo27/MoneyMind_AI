using backend.DTOs;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

/// <summary>Changes proposed by the AI assistant. Nothing is saved until the user confirms.</summary>
[Route("api/ai/actions")]
public sealed class AIActionsController(IAIActionService service, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    /// <summary>
    /// Carries out the action. Send the edited details in <c>payload</c>, or omit it to confirm what the AI proposed.
    /// On a validation error (400) the action stays pending so it can be fixed.
    /// </summary>
    [HttpPost("{id:guid}/confirm")]
    public async Task<ActionResult<AIActionResponse>> Confirm(Guid id, ConfirmAIActionRequest? request, CancellationToken ct) =>
        Ok(await service.ConfirmAsync(UserId, id, request?.Payload, ct));

    [HttpPost("{id:guid}/cancel")]
    public async Task<ActionResult<AIActionResponse>> Cancel(Guid id, CancellationToken ct) =>
        Ok(await service.CancelAsync(UserId, id, ct));
}

using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace backend.Controllers;

/// <summary>Weekly summary of the last complete week and its recommendations.</summary>
[Route("api/ai/insights")]
public sealed class AIInsightsController(IInsightService service, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    /// <summary>The latest weekly summary, or 204 when there is none yet.</summary>
    [HttpGet("weekly/latest")]
    public async Task<ActionResult<WeeklySummaryResponse>> GetLatest(CancellationToken ct) =>
        await service.GetLatestWeeklyAsync(UserId, ct) is { } summary ? Ok(summary) : NoContent();

    /// <summary>
    /// Creates last week's summary now if it does not exist yet (otherwise returns it; at most one AI call per week).
    /// 204 when there were no transactions last week.
    /// </summary>
    [HttpPost("weekly")]
    [EnableRateLimiting("ai")]
    public async Task<ActionResult<WeeklySummaryResponse>> Generate(CancellationToken ct) =>
        await service.GenerateWeeklyAsync(UserId, notify: false, ct) is { } summary ? Ok(summary) : NoContent();

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid id, CancellationToken ct)
    {
        await service.MarkReadAsync(UserId, id, ct);
        return NoContent();
    }

    /// <summary>Turns the recommendation into an AI action card (still needs the user's confirmation).</summary>
    [HttpPost("recommendations/{id:guid}/accept")]
    public async Task<ActionResult<AcceptRecommendationResponse>> Accept(Guid id, CancellationToken ct) =>
        Ok(await service.AcceptRecommendationAsync(UserId, id, ct));

    [HttpPost("recommendations/{id:guid}/dismiss")]
    public async Task<ActionResult<RecommendationResponse>> Dismiss(Guid id, CancellationToken ct) =>
        Ok(await service.DismissRecommendationAsync(UserId, id, ct));
}

using backend.DTOs.Responses;
using backend.Helpers;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/ai/usage")]
public sealed class AIUsageController(IAIQuotaService quota, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    /// <summary>Today's AI chat messages for the signed-in user: the limit, how many are used and when it resets.</summary>
    [HttpGet]
    public async Task<ActionResult<AIUsageResponse>> Get(CancellationToken ct) =>
        Ok((await quota.GetStatusAsync(UserId, ct)).ToUsage());
}

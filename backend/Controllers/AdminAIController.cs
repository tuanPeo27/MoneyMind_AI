using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/admin/ai")]
public sealed class AdminAIController(IAIQuotaService quota) : AdminControllerBase
{
    /// <summary>The default daily message limit and the values an admin can choose from.</summary>
    [HttpGet("quota")]
    public async Task<ActionResult<AIQuotaSettingsResponse>> GetQuota(CancellationToken ct) =>
        Ok(new AIQuotaSettingsResponse(await quota.GetDefaultLimitAsync(ct), AIQuota.AllowedLimits));

    /// <summary>Changes the limit of every user who has no limit of their own.</summary>
    [HttpPut("quota/default")]
    public async Task<ActionResult<AIQuotaSettingsResponse>> SetDefault(SetDefaultAIQuotaRequest request,
        CancellationToken ct)
    {
        await quota.SetDefaultLimitAsync(request.DailyLimit, ct);
        return Ok(new AIQuotaSettingsResponse(await quota.GetDefaultLimitAsync(ct), AIQuota.AllowedLimits));
    }
}

using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

/// <summary>
/// Transaction monitoring for administrators: aggregated statistics only. Administrators cannot read
/// individual transactions; those are reachable only by their owner through /api/transactions.
/// </summary>
[Route("api/admin/transactions")]
public sealed class AdminTransactionsController(IAdminTransactionService service) : AdminControllerBase
{
    /// <param name="from">Inclusive start date (UTC). Default: 29 days before <paramref name="to"/>.</param>
    /// <param name="to">Inclusive end date (UTC). Default: today. The range is limited to 366 days.</param>
    [HttpGet("stats")]
    public async Task<ActionResult<AdminTransactionStatsResponse>> GetStats(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct) =>
        Ok(await service.GetStatsAsync(from, to, ct));
}

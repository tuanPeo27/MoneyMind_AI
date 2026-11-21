using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/dashboard")]
public sealed class DashboardController(IDashboardService service, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    /// <summary>Balance, income/expense, recent transactions, budgets and goals. Defaults to the current month.</summary>
    [HttpGet("overview")]
    public async Task<ActionResult<DashboardOverviewResponse>> GetOverview(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct) =>
        Ok(await service.GetOverviewAsync(UserId, from, to, ct));

    /// <summary>Totals, category breakdown and trend for a date range. A date-only "to" includes that whole day.</summary>
    [HttpGet("report")]
    public async Task<ActionResult<ReportResponse>> GetReport(
        [FromQuery] DateTime from, [FromQuery] DateTime to, CancellationToken ct) =>
        Ok(await service.GetReportAsync(UserId, from, to, ct));

    [HttpGet("trend")]
    public async Task<ActionResult<IReadOnlyList<TrendPoint>>> GetTrend(
        [FromQuery] DateTime from, [FromQuery] DateTime to, [FromQuery] bool groupByMonth, CancellationToken ct) =>
        Ok(await service.GetTrendAsync(UserId, from, to, groupByMonth, ct));

    [HttpGet("snapshots")]
    public async Task<ActionResult<PagedResult<ReportSnapshotResponse>>> GetSnapshots(
        [FromQuery] ReportPeriodType? periodType, [FromQuery] PagingQuery paging, CancellationToken ct) =>
        Ok(await service.GetSnapshotsAsync(UserId, periodType, paging, ct));

    /// <summary>Saves (or refreshes) the weekly/monthly report for the period containing the reference date.</summary>
    [HttpPost("snapshots")]
    public async Task<ActionResult<ReportSnapshotResponse>> CreateSnapshot(
        [FromQuery] ReportPeriodType periodType, [FromQuery] DateOnly? referenceDate, CancellationToken ct) =>
        Ok(await service.CreateSnapshotAsync(UserId, periodType, referenceDate, ct));
}

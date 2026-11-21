using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[ApiController]
[Authorize(Roles = Roles.Admin)]
[Route("api/admin/system")]
public sealed class AdminSystemController(
    IHealthCheckService healthService,
    IAIProcessingLogService aiLogService,
    ISystemSettingService settingService,
    IAuditService auditService) : ControllerBase
{
    [HttpGet("stats")]
    public async Task<ActionResult<SystemStatsResponse>> GetStats(CancellationToken ct) =>
        Ok(await healthService.GetSystemStatsAsync(ct));

    // ---- health ----

    /// <summary>Most recent stored result for each service.</summary>
    [HttpGet("health")]
    public async Task<ActionResult<SystemHealthResponse>> GetHealth(CancellationToken ct) =>
        Ok(await healthService.GetLatestAsync(ct));

    /// <summary>Probes the database, AI service and SMTP now and stores the results.</summary>
    [HttpPost("health/check")]
    public async Task<ActionResult<SystemHealthResponse>> RunHealthCheck(CancellationToken ct) =>
        Ok(await healthService.CheckAsync(ct));

    [HttpGet("health/history")]
    public async Task<ActionResult<IReadOnlyList<HealthCheckResponse>>> GetHealthHistory(
        [FromQuery] string? serviceName, [FromQuery] int take, CancellationToken ct) =>
        Ok(await healthService.GetHistoryAsync(serviceName, take <= 0 ? 50 : take, ct));

    // ---- AI logs ----

    [HttpGet("ai-logs")]
    public async Task<ActionResult<PagedResult<AIProcessingLogResponse>>> GetAILogs(
        [FromQuery] AIProcessingLogQuery query, CancellationToken ct) =>
        Ok(await aiLogService.GetPagedAsync(query, ct));

    [HttpGet("ai-logs/stats")]
    public async Task<ActionResult<AIUsageStatsResponse>> GetAIStats(
        [FromQuery] DateTime from, [FromQuery] DateTime to, CancellationToken ct) =>
        Ok(await aiLogService.GetStatsAsync(from, to, ct));

    // ---- settings ----

    [HttpGet("settings")]
    public async Task<ActionResult<IReadOnlyList<SystemSettingResponse>>> GetSettings(CancellationToken ct) =>
        Ok(await settingService.GetAllAsync(ct));

    [HttpGet("settings/{key}")]
    public async Task<ActionResult<SystemSettingResponse>> GetSetting(string key, CancellationToken ct) =>
        Ok(await settingService.GetAsync(key, ct));

    [HttpPut("settings/{key}")]
    public async Task<ActionResult<SystemSettingResponse>> UpsertSetting(string key, UpsertSettingRequest request,
        CancellationToken ct) =>
        Ok(await settingService.UpsertAsync(key, request, ct));

    [HttpDelete("settings/{key}")]
    public async Task<IActionResult> DeleteSetting(string key, CancellationToken ct)
    {
        await settingService.DeleteAsync(key, ct);
        return NoContent();
    }

    // ---- audit ----

    [HttpGet("audit-logs")]
    public async Task<ActionResult<PagedResult<AuditLogResponse>>> GetAuditLogs(
        [FromQuery] AuditLogQuery query, CancellationToken ct) =>
        Ok(await auditService.GetPagedAsync(query, ct));
}

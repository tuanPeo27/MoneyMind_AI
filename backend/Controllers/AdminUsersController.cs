using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/admin/users")]
public sealed class AdminUsersController(IAdminUserService service) : AdminControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<AdminUserResponse>>> GetPaged(
        [FromQuery] AdminUserQuery query, CancellationToken ct) =>
        Ok(await service.GetPagedAsync(query, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<AdminUserResponse>> GetById(Guid id, CancellationToken ct) =>
        Ok(await service.GetByIdAsync(id, ct));

    /// <summary>Locks the account and ends all its sessions. Admins and your own account cannot be locked.</summary>
    [HttpPost("{id:guid}/lock")]
    public async Task<ActionResult<AdminUserResponse>> Lock(Guid id, LockUserRequest request, CancellationToken ct) =>
        Ok(await service.LockAsync(id, request, ct));

    [HttpPost("{id:guid}/unlock")]
    public async Task<ActionResult<AdminUserResponse>> Unlock(Guid id, CancellationToken ct) =>
        Ok(await service.UnlockAsync(id, ct));

    /// <summary>
    /// Grants the user 10, 20 or 50 AI messages per day, or unlimited (-1).
    /// A null dailyLimit returns the user to the system default.
    /// </summary>
    [HttpPut("{id:guid}/ai-quota")]
    public async Task<ActionResult<AdminUserResponse>> SetAIQuota(Guid id, SetAIQuotaRequest request,
        CancellationToken ct) =>
        Ok(await service.SetAIQuotaAsync(id, request, ct));
}

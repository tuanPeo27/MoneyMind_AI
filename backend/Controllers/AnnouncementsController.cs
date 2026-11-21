using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

/// <summary>Announcements shown to signed-in users.</summary>
[ApiController]
[Authorize]
[Route("api/announcements")]
public sealed class AnnouncementsController(IAnnouncementService service) : ControllerBase
{
    /// <summary>Active announcements within their start/end window.</summary>
    [HttpGet("active")]
    public async Task<ActionResult<IReadOnlyList<AnnouncementResponse>>> GetActive(CancellationToken ct) =>
        Ok(await service.GetActiveAsync(ct));
}

using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[Route("api/admin/announcements")]
public sealed class AdminAnnouncementsController(IAnnouncementService service) : AdminControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<AnnouncementResponse>>> GetPaged(
        [FromQuery] PagingQuery paging, CancellationToken ct) =>
        Ok(await service.GetPagedAsync(paging, ct));

    [HttpPost]
    public async Task<ActionResult<AnnouncementResponse>> Create(UpsertAnnouncementRequest request,
        CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await service.CreateAsync(request, ct));

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<AnnouncementResponse>> Update(Guid id, UpsertAnnouncementRequest request,
        CancellationToken ct) =>
        Ok(await service.UpdateAsync(id, request, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await service.DeleteAsync(id, ct);
        return NoContent();
    }
}

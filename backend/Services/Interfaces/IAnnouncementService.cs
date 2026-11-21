using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface IAnnouncementService
{
    Task<PagedResult<AnnouncementResponse>> GetPagedAsync(PagingQuery paging,
        CancellationToken cancellationToken = default);

    /// <summary>Announcements that are active and within their start/end window (for end users).</summary>
    Task<IReadOnlyList<AnnouncementResponse>> GetActiveAsync(CancellationToken cancellationToken = default);

    Task<AnnouncementResponse> CreateAsync(UpsertAnnouncementRequest request,
        CancellationToken cancellationToken = default);
    Task<AnnouncementResponse> UpdateAsync(Guid id, UpsertAnnouncementRequest request,
        CancellationToken cancellationToken = default);
    Task DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}

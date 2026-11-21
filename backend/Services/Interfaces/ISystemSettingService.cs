using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface ISystemSettingService
{
    Task<IReadOnlyList<SystemSettingResponse>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<SystemSettingResponse> GetAsync(string key, CancellationToken cancellationToken = default);
    Task<SystemSettingResponse> UpsertAsync(string key, UpsertSettingRequest request,
        CancellationToken cancellationToken = default);
    Task DeleteAsync(string key, CancellationToken cancellationToken = default);
}

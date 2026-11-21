using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface IUserAISettingService
{
    Task<AISettingsResponse> GetAsync(Guid userId, CancellationToken cancellationToken = default);
    Task<AISettingsResponse> UpdateAsync(Guid userId, UpdateAISettingsRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>Permanently deletes all conversations, messages and feedback of the user.</summary>
    Task DeleteChatHistoryAsync(Guid userId, CancellationToken cancellationToken = default);
}

using backend.DTOs;

namespace backend.Services.Interfaces;

/// <summary>Changes the AI assistant proposes. Each one is only carried out when the user confirms it.</summary>
public interface IAIActionService
{
    /// <summary>
    /// Checks the model's function calls (only known action types, at most 5), matches names to the user's records and
    /// adds them to the context as pending. The caller saves.
    /// </summary>
    Task<IReadOnlyList<AIActionResponse>> ProposeAsync(Guid userId, Guid messageId,
        IReadOnlyList<AIProposedAction> proposals, CancellationToken cancellationToken = default);

    Task<IReadOnlyDictionary<Guid, IReadOnlyList<AIActionResponse>>> GetForMessagesAsync(Guid userId,
        IReadOnlyCollection<Guid> messageIds, CancellationToken cancellationToken = default);

    /// <summary>Carries out the action with the existing finance services. On a validation error it stays pending.</summary>
    Task<AIActionResponse> ConfirmAsync(Guid userId, Guid actionId, AIActionPayload? edited,
        CancellationToken cancellationToken = default);

    Task<AIActionResponse> CancelAsync(Guid userId, Guid actionId, CancellationToken cancellationToken = default);
}

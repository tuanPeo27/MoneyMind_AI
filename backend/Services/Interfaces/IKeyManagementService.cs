namespace backend.Services.Interfaces;

public sealed record DataKey(int Version, byte[] Key);

/// <summary>Manages per-user data encryption keys (DEK), wrapped with the server master key.</summary>
public interface IKeyManagementService
{
    /// <summary>Returns the active key of the user, creating the first one if needed.</summary>
    Task<DataKey> GetActiveKeyAsync(Guid userId, CancellationToken cancellationToken = default);

    Task<DataKey> GetKeyAsync(Guid userId, int version, CancellationToken cancellationToken = default);

    /// <summary>Deactivates the current key and creates a new version. Old versions stay for decryption.</summary>
    Task<int> RotateKeyAsync(Guid userId, CancellationToken cancellationToken = default);
}

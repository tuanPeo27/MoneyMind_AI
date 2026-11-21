namespace backend.Services.Interfaces;

public sealed record EncryptedData(byte[] Cipher, byte[] Nonce, int KeyVersion);

/// <summary>AES-256-GCM encryption of user content with the user's data key.</summary>
public interface IEncryptionService
{
    Task<EncryptedData> EncryptAsync(Guid userId, string plaintext, CancellationToken cancellationToken = default);

    Task<string> DecryptAsync(Guid userId, byte[] cipher, byte[] nonce, int keyVersion,
        CancellationToken cancellationToken = default);
}

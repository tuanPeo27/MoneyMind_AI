using System.Security.Cryptography;
using System.Text;
using backend.Services.Interfaces;

namespace backend.Services.Implementations;

public sealed class EncryptionService(IKeyManagementService keys) : IEncryptionService
{
    private const int NonceSize = 12;
    private const int TagSize = 16;

    public async Task<EncryptedData> EncryptAsync(Guid userId, string plaintext,
        CancellationToken cancellationToken = default)
    {
        var dataKey = await keys.GetActiveKeyAsync(userId, cancellationToken);
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cipher = new byte[plain.Length];
        var tag = new byte[TagSize];

        using var aes = new AesGcm(dataKey.Key, TagSize);
        aes.Encrypt(nonce, plain, cipher, tag);
        CryptographicOperations.ZeroMemory(dataKey.Key);
        return new EncryptedData([.. tag, .. cipher], nonce, dataKey.Version);
    }

    public async Task<string> DecryptAsync(Guid userId, byte[] cipher, byte[] nonce, int keyVersion,
        CancellationToken cancellationToken = default)
    {
        if (nonce.Length != NonceSize || cipher.Length < TagSize)
            throw new CryptographicException("Invalid encrypted content.");

        var dataKey = await keys.GetKeyAsync(userId, keyVersion, cancellationToken);
        var plain = new byte[cipher.Length - TagSize];
        using var aes = new AesGcm(dataKey.Key, TagSize);
        aes.Decrypt(nonce, cipher.AsSpan(TagSize), cipher.AsSpan(0, TagSize), plain);
        CryptographicOperations.ZeroMemory(dataKey.Key);
        return Encoding.UTF8.GetString(plain);
    }
}

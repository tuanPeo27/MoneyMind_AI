using System.Security.Cryptography;
using backend.Data;
using backend.Helpers;
using backend.Models;
using backend.Options;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services.Implementations;

public sealed class KeyManagementService(AppDbContext db, IOptions<EncryptionOptions> options)
    : IKeyManagementService
{
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private const int KeySize = 32;
    private readonly byte[] _masterKey = DecodeMasterKey(options.Value.MasterKey);

    public async Task<DataKey> GetActiveKeyAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var entity = await db.UserEncryptionKeys.AsNoTracking()
            .Where(k => k.UserId == userId && k.IsActive)
            .OrderByDescending(k => k.KeyVersion)
            .FirstOrDefaultAsync(cancellationToken);

        if (entity is not null) return new DataKey(entity.KeyVersion, Unwrap(entity.WrappedDek));

        var version = await db.UserEncryptionKeys
            .Where(k => k.UserId == userId)
            .MaxAsync(k => (int?)k.KeyVersion, cancellationToken) ?? 0;
        var key = RandomNumberGenerator.GetBytes(KeySize);
        db.UserEncryptionKeys.Add(new UserEncryptionKey
        {
            UserId = userId,
            KeyVersion = version + 1,
            WrappedDek = Wrap(key),
            IsActive = true
        });
        await db.SaveChangesAsync(cancellationToken);
        return new DataKey(version + 1, key);
    }

    public async Task<DataKey> GetKeyAsync(Guid userId, int version, CancellationToken cancellationToken = default)
    {
        var entity = await db.UserEncryptionKeys.AsNoTracking()
            .FirstOrDefaultAsync(k => k.UserId == userId && k.KeyVersion == version, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy khóa mã hóa của hội thoại.");
        return new DataKey(version, Unwrap(entity.WrappedDek));
    }

    public async Task<int> RotateKeyAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var current = await db.UserEncryptionKeys
            .Where(k => k.UserId == userId && k.IsActive)
            .ToListAsync(cancellationToken);
        foreach (var key in current)
        {
            key.IsActive = false;
            key.RotatedAt = DateTime.UtcNow;
        }

        var version = await db.UserEncryptionKeys.Where(k => k.UserId == userId)
            .MaxAsync(k => (int?)k.KeyVersion, cancellationToken) ?? 0;
        db.UserEncryptionKeys.Add(new UserEncryptionKey
        {
            UserId = userId,
            KeyVersion = version + 1,
            WrappedDek = Wrap(RandomNumberGenerator.GetBytes(KeySize)),
            IsActive = true
        });
        await db.SaveChangesAsync(cancellationToken);
        return version + 1;
    }

    private byte[] Wrap(byte[] key)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cipher = new byte[key.Length];
        var tag = new byte[TagSize];
        using var aes = new AesGcm(_masterKey, TagSize);
        aes.Encrypt(nonce, key, cipher, tag);
        return [.. nonce, .. tag, .. cipher];
    }

    private byte[] Unwrap(byte[] wrapped)
    {
        if (wrapped.Length != NonceSize + TagSize + KeySize)
            throw new CryptographicException("Invalid wrapped data key.");

        var plain = new byte[KeySize];
        using var aes = new AesGcm(_masterKey, TagSize);
        aes.Decrypt(wrapped.AsSpan(0, NonceSize), wrapped.AsSpan(NonceSize + TagSize),
            wrapped.AsSpan(NonceSize, TagSize), plain);
        return plain;
    }

    private static byte[] DecodeMasterKey(string value)
    {
        try
        {
            var key = Convert.FromBase64String(value);
            return key.Length == KeySize ? key : throw new FormatException();
        }
        catch (FormatException)
        {
            throw new InvalidOperationException("Encryption:MasterKey must be a Base64-encoded 32-byte key.");
        }
    }
}

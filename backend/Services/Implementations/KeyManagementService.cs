using System.Security.Cryptography;
using backend.Data;
using backend.Helpers;
using backend.Models;
using backend.Options;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services.Implementations;

/// <remarks>
/// Scoped: unwrapped keys are kept for the rest of the request, so decrypting a conversation of 20 messages reads and
/// unwraps the key once instead of 20 times. Callers receive a copy (they may wipe it); the cached keys are wiped when
/// the request ends.
/// </remarks>
public sealed class KeyManagementService(AppDbContext db, IOptions<EncryptionOptions> options)
    : IKeyManagementService, IDisposable
{
    private readonly Dictionary<(Guid UserId, int Version), byte[]> _keys = [];
    private readonly Dictionary<Guid, int> _activeVersion = [];

    private const int NonceSize = 12;
    private const int TagSize = 16;
    private const int KeySize = 32;
    private readonly byte[] _masterKey = DecodeMasterKey(options.Value.MasterKey);

    public async Task<DataKey> GetActiveKeyAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        if (_activeVersion.TryGetValue(userId, out var cachedVersion) && _keys.TryGetValue((userId, cachedVersion), out var cached))
            return new DataKey(cachedVersion, (byte[])cached.Clone());

        var entity = await db.UserEncryptionKeys.AsNoTracking()
            .Where(k => k.UserId == userId && k.IsActive)
            .OrderByDescending(k => k.KeyVersion)
            .FirstOrDefaultAsync(cancellationToken);

        if (entity is not null) return Remember(userId, entity.KeyVersion, Unwrap(entity.WrappedDek), active: true);

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
        return Remember(userId, version + 1, key, active: true);
    }

    public async Task<DataKey> GetKeyAsync(Guid userId, int version, CancellationToken cancellationToken = default)
    {
        if (_keys.TryGetValue((userId, version), out var cached)) return new DataKey(version, (byte[])cached.Clone());

        var entity = await db.UserEncryptionKeys.AsNoTracking()
            .FirstOrDefaultAsync(k => k.UserId == userId && k.KeyVersion == version, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy khóa mã hóa của hội thoại.");
        return Remember(userId, version, Unwrap(entity.WrappedDek), active: false);
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
        _activeVersion.Remove(userId); // old versions stay valid for decryption, the new one becomes active
        return version + 1;
    }

    public void Dispose()
    {
        foreach (var key in _keys.Values) CryptographicOperations.ZeroMemory(key);
        _keys.Clear();
        _activeVersion.Clear();
    }

    /// <summary>Caches the unwrapped key for this request and hands out a copy the caller may wipe.</summary>
    private DataKey Remember(Guid userId, int version, byte[] key, bool active)
    {
        if (_keys.Remove((userId, version), out var previous)) CryptographicOperations.ZeroMemory(previous);
        _keys[(userId, version)] = key;
        if (active) _activeVersion[userId] = version;
        return new DataKey(version, (byte[])key.Clone());
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

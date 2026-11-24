using System.Collections.Concurrent;
using Microsoft.Extensions.Caching.Memory;

namespace backend.Services.Implementations;

/// <summary>
/// Keeps the AI financial context of each user for a short time, so consecutive chat messages do not rebuild it.
/// Any change to the user's finances invalidates it (see <see cref="backend.Data.FinancialDataChangeInterceptor"/>).
/// </summary>
/// <remarks>
/// Invalidation bumps a generation number that is part of the cache key. A caller takes the key <em>before</em> it
/// reads the data, so a context built from data that changed meanwhile is stored under an old key and never served.
/// </remarks>
public sealed class FinancialContextCache(IMemoryCache cache)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(60);

    private readonly ConcurrentDictionary<Guid, long> _userGeneration = new();
    private long _sharedGeneration; // system categories are shared by every user

    public string KeyFor(Guid userId) =>
        $"ai-context:{userId:N}:{_userGeneration.GetValueOrDefault(userId)}:{Interlocked.Read(ref _sharedGeneration)}";

    public bool TryGet(string key, out string context) => cache.TryGetValue(key, out context!);

    public void Set(string key, string context) =>
        cache.Set(key, context, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = Lifetime, Size = 1 });

    public void Invalidate(Guid userId) => _userGeneration.AddOrUpdate(userId, 1, (_, generation) => generation + 1);

    public void InvalidateAll() => Interlocked.Increment(ref _sharedGeneration);
}

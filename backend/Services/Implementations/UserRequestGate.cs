using System.Collections.Concurrent;

namespace backend.Services.Implementations;

/// <summary>
/// Lets one AI chat request per user run at a time. Without it, a user could fire many requests in parallel before
/// the first one is counted and go past the daily limit, or send two messages at once and collide on message order.
/// </summary>
public sealed class UserRequestGate
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();

    /// <returns>A token to dispose when the request ends, or null when this user already has a request running.</returns>
    public IDisposable? TryEnter(Guid userId)
    {
        var gate = _locks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
        return gate.Wait(0) ? new Releaser(gate) : null;
    }

    private sealed class Releaser(SemaphoreSlim gate) : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0) gate.Release();
        }
    }
}

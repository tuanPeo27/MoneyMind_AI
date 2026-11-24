using System.Runtime.CompilerServices;
using backend.Models;
using backend.Services.Implementations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace backend.Data;

/// <summary>
/// Invalidates the cached AI financial context of every user whose accounts, transactions, categories, budgets or
/// savings goals are saved. It runs before the save (so a request does not keep using old data) and again after it
/// (so a context rebuilt while the save was running is not served either).
/// </summary>
/// <remarks><c>ExecuteUpdate</c>/<c>ExecuteDelete</c> bypass this; callers of those invalidate the cache themselves.</remarks>
public sealed class FinancialDataChangeInterceptor(FinancialContextCache cache) : SaveChangesInterceptor
{
    private sealed record Changes(HashSet<Guid> Users, bool Shared);

    private readonly ConditionalWeakTable<DbContext, Changes> _pending = new();

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
        InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Capture(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Capture(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result,
        CancellationToken cancellationToken = default)
    {
        Release(eventData.Context);
        return base.SavedChangesAsync(eventData, result, cancellationToken);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Release(eventData.Context);
        return base.SavedChanges(eventData, result);
    }

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context) _pending.Remove(context);
        return base.SaveChangesFailedAsync(eventData, cancellationToken);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        if (eventData.Context is { } context) _pending.Remove(context);
        base.SaveChangesFailed(eventData);
    }

    private void Capture(DbContext? context)
    {
        if (context is null) return;
        var users = new HashSet<Guid>();
        var shared = false;

        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;
            switch (entry.Entity)
            {
                case Transaction t: users.Add(t.UserId); break;
                case Account a: users.Add(a.UserId); break;
                case Budget b: users.Add(b.UserId); break;
                case FinancialGoal g: users.Add(g.UserId); break;
                case Category { UserId: { } owner }: users.Add(owner); break;
                case Category: shared = true; break;
                case GoalContribution c:
                    if (context.Set<FinancialGoal>().Local.FirstOrDefault(g => g.Id == c.GoalId) is { } goal) users.Add(goal.UserId);
                    break;
            }
        }

        if (users.Count == 0 && !shared) return;
        Invalidate(users, shared);
        _pending.AddOrUpdate(context, new Changes(users, shared));
    }

    private void Release(DbContext? context)
    {
        if (context is null || !_pending.TryGetValue(context, out var changes)) return;
        _pending.Remove(context);
        Invalidate(changes.Users, changes.Shared);
    }

    private void Invalidate(IEnumerable<Guid> users, bool shared)
    {
        foreach (var user in users) cache.Invalidate(user);
        if (shared) cache.InvalidateAll();
    }
}

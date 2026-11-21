using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class AccountService(AppDbContext db) : IAccountService
{
    public async Task<IReadOnlyList<AccountResponse>> GetAllAsync(Guid userId, bool includeArchived = false,
        CancellationToken cancellationToken = default)
    {
        var accounts = await db.Accounts.AsNoTracking()
            .Where(a => a.UserId == userId && (includeArchived || !a.IsArchived))
            .OrderBy(a => a.CreatedAt)
            .ToListAsync(cancellationToken);

        var net = await GetNetByAccountAsync(userId, accounts.Select(a => a.Id).ToList(), cancellationToken);
        return accounts.Select(a => Map(a, net.GetValueOrDefault(a.Id))).ToList();
    }

    public async Task<AccountResponse> GetByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var account = await db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == id && a.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy ví.");

        var net = await GetNetByAccountAsync(userId, [id], cancellationToken);
        return Map(account, net.GetValueOrDefault(id));
    }

    public async Task<AccountResponse> CreateAsync(Guid userId, CreateAccountRequest request,
        CancellationToken cancellationToken = default)
    {
        var name = request.Name.Trim();
        await EnsureUniqueNameAsync(userId, name, null, cancellationToken);

        var account = new Account
        {
            UserId = userId,
            Name = name,
            AccountType = request.AccountType,
            InitialBalance = request.InitialBalance,
            Currency = request.Currency.Trim().ToUpperInvariant()
        };
        db.Accounts.Add(account);
        await db.SaveChangesAsync(cancellationToken);
        return Map(account, 0m);
    }

    public async Task<AccountResponse> UpdateAsync(Guid userId, Guid id, UpdateAccountRequest request,
        CancellationToken cancellationToken = default)
    {
        var account = await db.Accounts.FirstOrDefaultAsync(a => a.Id == id && a.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy ví.");

        var name = request.Name.Trim();
        await EnsureUniqueNameAsync(userId, name, id, cancellationToken);

        account.Name = name;
        account.AccountType = request.AccountType;
        account.IsArchived = request.IsArchived;
        await db.SaveChangesAsync(cancellationToken);

        var net = await GetNetByAccountAsync(userId, [id], cancellationToken);
        return Map(account, net.GetValueOrDefault(id));
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var account = await db.Accounts.FirstOrDefaultAsync(a => a.Id == id && a.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy ví.");

        var hasTransactions = await db.Transactions.AnyAsync(t => t.AccountId == id, cancellationToken);
        if (hasTransactions) account.IsArchived = true;
        else db.Accounts.Remove(account);

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureUniqueNameAsync(Guid userId, string name, Guid? excludeId, CancellationToken ct)
    {
        var exists = await db.Accounts.AnyAsync(
            a => a.UserId == userId && a.Name == name && !a.IsArchived && a.Id != excludeId, ct);
        if (exists) throw new ConflictException("Tên ví đã tồn tại.");
    }

    /// <summary>Income minus expense per account.</summary>
    private async Task<Dictionary<Guid, decimal>> GetNetByAccountAsync(Guid userId, List<Guid> accountIds,
        CancellationToken cancellationToken)
    {
        if (accountIds.Count == 0) return [];

        var rows = await db.Transactions.AsNoTracking()
            .Where(t => t.UserId == userId && accountIds.Contains(t.AccountId))
            .GroupBy(t => new { t.AccountId, t.Type })
            .Select(g => new { g.Key.AccountId, g.Key.Type, Total = g.Sum(x => x.Amount) })
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(r => r.AccountId)
            .ToDictionary(
                g => g.Key,
                g => g.Sum(r => r.Type == TransactionType.Income ? r.Total : -r.Total));
    }

    private static AccountResponse Map(Account a, decimal net) =>
        new(a.Id, a.Name, a.AccountType, a.InitialBalance, a.InitialBalance + net, a.Currency, a.IsArchived,
            a.CreatedAt);
}

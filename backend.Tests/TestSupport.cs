using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Hubs;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace backend.Tests;

/// <summary>
/// SQLite stands in for SQL Server. SQLite cannot SUM decimal columns, so decimals are stored as doubles
/// (exact for the whole-number amounts the tests use).
/// </summary>
internal sealed class DecimalAsDoubleModelCustomizer(ModelCustomizerDependencies dependencies)
    : ModelCustomizer(dependencies)
{
    public override void Customize(ModelBuilder modelBuilder, DbContext context)
    {
        base.Customize(modelBuilder, context);
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        foreach (var property in entity.GetProperties())
        {
            if (property.ClrType == typeof(decimal))
                property.SetValueConverter(new ValueConverter<decimal, double>(v => (double)v, v => (decimal)v));
            // SQL Server types such as nvarchar(max) are not valid SQLite type names.
            if (property.GetColumnType()?.Contains("(max)", StringComparison.OrdinalIgnoreCase) == true)
                property.SetColumnType(null);
        }
    }
}

/// <summary>One in-memory SQLite database per test class instance.</summary>
public abstract class DbTestBase : IDisposable
{
    private readonly SqliteConnection _connection;
    protected AppDbContext Db { get; }
    protected static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    protected static readonly Guid OtherUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    protected DbTestBase()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .ReplaceService<IModelCustomizer, DecimalAsDoubleModelCustomizer>()
            .Options;
        Db = new AppDbContext(options);
        Db.Database.EnsureCreated();
        AddUser(UserId, "user@test.com");
        AddUser(OtherUserId, "other@test.com");
        Db.SaveChanges();
    }

    protected ApplicationUser AddUser(Guid id, string email, string timeZone = "Asia/Ho_Chi_Minh", int? limit = null)
    {
        var user = new ApplicationUser
        {
            Id = id, UserName = email, NormalizedUserName = email.ToUpperInvariant(), Email = email,
            NormalizedEmail = email.ToUpperInvariant(), FullName = "Test " + email, TimeZoneId = timeZone,
            AIDailyMessageLimit = limit
        };
        Db.Users.Add(user);
        Db.SaveChanges();
        return user;
    }

    protected Account AddAccount(Guid? userId = null, string name = "Cash", decimal initial = 1_000_000m,
        bool archived = false)
    {
        var account = new Account
        {
            UserId = userId ?? UserId, Name = name, InitialBalance = initial, IsArchived = archived
        };
        Db.Accounts.Add(account);
        Db.SaveChanges();
        return account;
    }

    protected Category AddCategory(string name = "Food", CategoryType type = CategoryType.Expense,
        Guid? userId = null, bool system = false, bool active = true)
    {
        var category = new Category
        {
            UserId = system ? null : userId ?? UserId, Name = name, Type = type, IsSystem = system, IsActive = active
        };
        Db.Categories.Add(category);
        Db.SaveChanges();
        return category;
    }

    protected Transaction AddTransaction(Account account, Category category, decimal amount,
        TransactionType type = TransactionType.Expense, DateTime? date = null, string? description = null,
        Guid? userId = null)
    {
        var transaction = new Transaction
        {
            UserId = userId ?? account.UserId, AccountId = account.Id, CategoryId = category.Id, Amount = amount,
            Type = type, TransactionDate = date ?? new DateTime(2025, 1, 15, 0, 0, 0, DateTimeKind.Utc),
            Description = description
        };
        Db.Transactions.Add(transaction);
        Db.SaveChanges();
        return transaction;
    }

    public void Dispose()
    {
        Db.Dispose();
        _connection.Dispose();
        GC.SuppressFinalize(this);
    }
}

public sealed class FakeCurrentUser(Guid? userId = null, bool isAdmin = false) : ICurrentUserService
{
    public Guid? UserId { get; set; } = userId;
    public Guid RequiredUserId => UserId ?? throw new InvalidOperationException("Anonymous");
    public bool IsAdmin { get; set; } = isAdmin;
    public string? IpAddress => "127.0.0.1";
    public string? UserAgent => "tests";
}

public sealed class FakeAudit : IAuditService
{
    public List<(string Action, string TargetType, Guid? TargetId, string? Detail)> Entries { get; } = [];

    public Task LogAsync(string action, string targetType, Guid? targetId = null, string? detail = null,
        CancellationToken cancellationToken = default)
    {
        Entries.Add((action, targetType, targetId, detail));
        return Task.CompletedTask;
    }

    public Task<PagedResult<AuditLogResponse>> GetPagedAsync(AuditLogQuery query,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();
}

public sealed class FakeNotifications : INotificationService
{
    public List<(Guid UserId, NotificationType Type, NotificationSource Source, string Title, string Message,
        string? RelatedType, Guid? RelatedId)> Created { get; } = [];

    public Task CreateAsync(Guid userId, NotificationType type, NotificationSource source, string title,
        string message, string? relatedType = null, Guid? relatedId = null,
        CancellationToken cancellationToken = default)
    {
        Created.Add((userId, type, source, title, message, relatedType, relatedId));
        return Task.CompletedTask;
    }

    public Task<PagedResult<NotificationResponse>> GetPagedAsync(Guid userId, NotificationQuery query,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();
    public Task<int> GetUnreadCountAsync(Guid userId, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
    public Task MarkReadAsync(Guid userId, Guid id, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
    public Task MarkAllReadAsync(Guid userId, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
    public Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
}

public sealed class FakeBudgetService : IBudgetService
{
    public bool Throw { get; set; }
    public List<(Guid UserId, Guid CategoryId, DateTime Date)> Checks { get; } = [];

    public Task CheckAlertsAsync(Guid userId, Guid categoryId, DateTime transactionDate,
        CancellationToken cancellationToken = default)
    {
        Checks.Add((userId, categoryId, transactionDate));
        if (Throw) throw new InvalidOperationException("boom");
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<BudgetResponse>> GetAllAsync(Guid userId, DateOnly? activeOn = null,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();
    public Task<BudgetResponse> GetByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
    public Task<BudgetResponse> CreateAsync(Guid userId, UpsertBudgetRequest request,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();
    public Task<BudgetResponse> UpdateAsync(Guid userId, Guid id, UpsertBudgetRequest request,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();
    public Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
    public Task<IReadOnlyList<BudgetResponse>> CreateManyAsync(Guid userId, IReadOnlyList<UpsertBudgetRequest> requests,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();
    public Task<BulkCreateBudgetsResponse> CreateForPeriodAsync(Guid userId, BulkCreateBudgetsRequest request,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();
}

public sealed class FakeHub : IHubContext<NotificationHub>
{
    public RecordingClients ClientsImpl { get; } = new();
    public IHubClients Clients => ClientsImpl;
    public IGroupManager Groups => throw new NotSupportedException();
}

public sealed class RecordingClients : IHubClients
{
    public bool Fail { get; set; }
    public List<(string User, string Method, object?[] Args)> Sent { get; } = [];

    public IClientProxy User(string userId) => new Proxy(this, userId);
    public IClientProxy All => throw new NotSupportedException();
    public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => throw new NotSupportedException();
    public IClientProxy Client(string connectionId) => throw new NotSupportedException();
    public IClientProxy Clients(IReadOnlyList<string> connectionIds) => throw new NotSupportedException();
    public IClientProxy Group(string groupName) => throw new NotSupportedException();
    public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) =>
        throw new NotSupportedException();
    public IClientProxy Groups(IReadOnlyList<string> groupNames) => throw new NotSupportedException();
    public IClientProxy Users(IReadOnlyList<string> userIds) => throw new NotSupportedException();

    private sealed class Proxy(RecordingClients owner, string user) : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
        {
            if (owner.Fail) throw new InvalidOperationException("hub down");
            owner.Sent.Add((user, method, args));
            return Task.CompletedTask;
        }
    }
}

public sealed class FakeKeys : IKeyManagementService
{
    private readonly Dictionary<(Guid, int), byte[]> _keys = new();
    public int CurrentVersion { get; private set; } = 1;

    private byte[] KeyFor(Guid userId, int version)
    {
        if (!_keys.TryGetValue((userId, version), out var key))
            _keys[(userId, version)] = key = System.Security.Cryptography.RandomNumberGenerator.GetBytes(32);
        return (byte[])key.Clone();
    }

    public Task<DataKey> GetActiveKeyAsync(Guid userId, CancellationToken cancellationToken = default) =>
        Task.FromResult(new DataKey(CurrentVersion, KeyFor(userId, CurrentVersion)));

    public Task<DataKey> GetKeyAsync(Guid userId, int version, CancellationToken cancellationToken = default) =>
        Task.FromResult(new DataKey(version, KeyFor(userId, version)));

    public Task<int> RotateKeyAsync(Guid userId, CancellationToken cancellationToken = default) =>
        Task.FromResult(++CurrentVersion);
}

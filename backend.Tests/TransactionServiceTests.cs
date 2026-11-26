using backend.DTOs.Requests;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests;

public class TransactionServiceTests : DbTestBase
{
    private readonly FakeBudgetService _budgets = new();
    private readonly TransactionService _sut;
    private readonly Account _account;
    private readonly Category _food;
    private readonly Category _salary;

    private static readonly DateTime Jan15 = new(2025, 1, 15, 0, 0, 0, DateTimeKind.Utc);

    public TransactionServiceTests()
    {
        _sut = new TransactionService(Db, _budgets, NullLogger<TransactionService>.Instance);
        _account = AddAccount(name: "Main");
        _food = AddCategory("Food");
        _salary = AddCategory("Salary", CategoryType.Income);
    }

    private UpsertTransactionRequest Expense(decimal amount = 100m, string? description = null, DateTime? date = null,
        Guid? accountId = null, Guid? categoryId = null, TransactionSource source = TransactionSource.Manual) =>
        new(accountId ?? _account.Id, categoryId ?? _food.Id, amount, TransactionType.Expense, description,
            date ?? Jan15, source);

    private UpsertTransactionRequest Income(decimal amount = 100m) =>
        new(_account.Id, _salary.Id, amount, TransactionType.Income, null, Jan15);

    // ---- Create ----

    [Fact]
    public async Task Create_ReturnsResponseWithAccountAndCategoryNames()
    {
        var result = await _sut.CreateAsync(UserId, Expense(250m, "lunch"));
        Assert.Equal("Main", result.AccountName);
        Assert.Equal("Food", result.CategoryName);
        Assert.Equal(250m, result.Amount);
        Assert.Equal(TransactionType.Expense, result.Type);
        Assert.Equal("lunch", result.Description);
    }

    [Fact]
    public async Task Create_PersistsTransactionForUser()
    {
        var result = await _sut.CreateAsync(UserId, Expense());
        Assert.Equal(UserId, Db.Transactions.Single(t => t.Id == result.Id).UserId);
    }

    [Theory]
    [InlineData("  coffee  ", "coffee")]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData(null, null)]
    public async Task Create_NormalizesDescription(string? input, string? expected)
    {
        var result = await _sut.CreateAsync(UserId, Expense(description: input));
        Assert.Equal(expected, result.Description);
    }

    [Fact]
    public async Task Create_TreatsUnspecifiedDateAsUtc()
    {
        var result = await _sut.CreateAsync(UserId, Expense(date: new DateTime(2025, 2, 3, 4, 5, 6, DateTimeKind.Unspecified)));
        Assert.Equal(new DateTime(2025, 2, 3, 4, 5, 6), result.TransactionDate);
    }

    [Theory]
    [InlineData(TransactionSource.Manual)]
    [InlineData(TransactionSource.AIDraft)]
    public async Task Create_KeepsSource(TransactionSource source)
    {
        var result = await _sut.CreateAsync(UserId, Expense(source: source));
        Assert.Equal(source, result.Source);
    }

    [Fact]
    public async Task Create_UnknownAccount_ThrowsBadRequest()
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.CreateAsync(UserId, Expense(accountId: Guid.NewGuid())));
    }

    [Fact]
    public async Task Create_AccountOfAnotherUser_ThrowsBadRequest()
    {
        var theirs = AddAccount(OtherUserId, "Theirs");
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateAsync(UserId, Expense(accountId: theirs.Id)));
    }

    [Fact]
    public async Task Create_ArchivedAccount_ThrowsBadRequest()
    {
        var archived = AddAccount(name: "Old", archived: true);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateAsync(UserId, Expense(accountId: archived.Id)));
    }

    [Fact]
    public async Task Create_UnknownCategory_ThrowsBadRequest()
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.CreateAsync(UserId, Expense(categoryId: Guid.NewGuid())));
    }

    [Fact]
    public async Task Create_CategoryOfAnotherUser_ThrowsBadRequest()
    {
        var theirs = AddCategory("Theirs", userId: OtherUserId);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateAsync(UserId, Expense(categoryId: theirs.Id)));
    }

    [Fact]
    public async Task Create_SystemCategory_IsAllowed()
    {
        var system = AddCategory("Transport", system: true);
        var result = await _sut.CreateAsync(UserId, Expense(categoryId: system.Id));
        Assert.Equal("Transport", result.CategoryName);
    }

    [Fact]
    public async Task Create_InactiveCategory_ThrowsBadRequest()
    {
        var inactive = AddCategory("Old", active: false);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateAsync(UserId, Expense(categoryId: inactive.Id)));
    }

    [Fact]
    public async Task Create_ExpenseWithIncomeCategory_ThrowsBadRequest()
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.CreateAsync(UserId, Expense(categoryId: _salary.Id)));
    }

    [Fact]
    public async Task Create_IncomeWithExpenseCategory_ThrowsBadRequest()
    {
        var request = new UpsertTransactionRequest(_account.Id, _food.Id, 10m, TransactionType.Income, null, Jan15);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateAsync(UserId, request));
    }

    [Fact]
    public async Task Create_Income_IsAccepted()
    {
        var result = await _sut.CreateAsync(UserId, Income(500m));
        Assert.Equal(TransactionType.Income, result.Type);
    }

    [Fact]
    public async Task Create_Expense_ChecksBudgetAlerts()
    {
        await _sut.CreateAsync(UserId, Expense());
        var check = Assert.Single(_budgets.Checks);
        Assert.Equal(UserId, check.UserId);
        Assert.Equal(_food.Id, check.CategoryId);
    }

    [Fact]
    public async Task Create_Income_DoesNotCheckBudgetAlerts()
    {
        await _sut.CreateAsync(UserId, Income());
        Assert.Empty(_budgets.Checks);
    }

    [Fact]
    public async Task Create_BudgetCheckFailure_DoesNotFailTheTransaction()
    {
        _budgets.Throw = true;
        var result = await _sut.CreateAsync(UserId, Expense());
        Assert.True(Db.Transactions.Any(t => t.Id == result.Id));
    }

    [Fact]
    public async Task Create_InvalidRequest_SavesNothing()
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.CreateAsync(UserId, Expense(accountId: Guid.NewGuid())));
        Assert.Empty(Db.Transactions);
    }

    // ---- GetById ----

    [Fact]
    public async Task GetById_ReturnsTransaction()
    {
        var created = await _sut.CreateAsync(UserId, Expense(77m));
        var result = await _sut.GetByIdAsync(UserId, created.Id);
        Assert.Equal(77m, result.Amount);
    }

    [Fact]
    public async Task GetById_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(UserId, Guid.NewGuid()));

    [Fact]
    public async Task GetById_OfAnotherUser_ThrowsNotFound()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(OtherUserId, created.Id));
    }

    // ---- Update ----

    [Fact]
    public async Task Update_ChangesFields()
    {
        var created = await _sut.CreateAsync(UserId, Expense(10m, "a"));
        var result = await _sut.UpdateAsync(UserId, created.Id, Expense(99m, "b", new DateTime(2025, 3, 1, 0, 0, 0, DateTimeKind.Utc)));
        Assert.Equal(99m, result.Amount);
        Assert.Equal("b", result.Description);
        Assert.Equal(new DateTime(2025, 3, 1), result.TransactionDate);
    }

    [Fact]
    public async Task Update_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.UpdateAsync(UserId, Guid.NewGuid(), Expense()));

    [Fact]
    public async Task Update_OfAnotherUser_ThrowsNotFound()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.UpdateAsync(OtherUserId, created.Id, Expense()));
    }

    [Fact]
    public async Task Update_KeepingArchivedAccount_IsAllowed()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        _account.IsArchived = true;
        Db.SaveChanges();
        var result = await _sut.UpdateAsync(UserId, created.Id, Expense(55m));
        Assert.Equal(55m, result.Amount);
    }

    [Fact]
    public async Task Update_MovingToArchivedAccount_ThrowsBadRequest()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        var archived = AddAccount(name: "Old", archived: true);
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.UpdateAsync(UserId, created.Id, Expense(accountId: archived.Id)));
    }

    [Fact]
    public async Task Update_TypeMismatch_ThrowsBadRequest()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        var request = new UpsertTransactionRequest(_account.Id, _food.Id, 10m, TransactionType.Income, null, Jan15);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.UpdateAsync(UserId, created.Id, request));
    }

    [Fact]
    public async Task Update_Expense_ChecksBudgetAlerts()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        _budgets.Checks.Clear();
        await _sut.UpdateAsync(UserId, created.Id, Expense(20m));
        Assert.Single(_budgets.Checks);
    }

    [Fact]
    public async Task Update_BumpsUpdatedAt()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        var result = await _sut.UpdateAsync(UserId, created.Id, Expense(20m));
        Assert.True(result.UpdatedAt >= created.UpdatedAt);
    }

    // ---- Delete ----

    [Fact]
    public async Task Delete_RemovesTransaction()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        await _sut.DeleteAsync(UserId, created.Id);
        Assert.Empty(Db.Transactions);
    }

    [Fact]
    public async Task Delete_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, Guid.NewGuid()));

    [Fact]
    public async Task Delete_OfAnotherUser_ThrowsNotFoundAndKeepsIt()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(OtherUserId, created.Id));
        Assert.Single(Db.Transactions);
    }

    [Fact]
    public async Task Delete_DetachesSuggestionLogsInsteadOfDeletingThem()
    {
        var created = await _sut.CreateAsync(UserId, Expense());
        Db.CategorySuggestionLogs.Add(new CategorySuggestionLog
        {
            UserId = UserId, TransactionId = created.Id, Description = "lunch", SuggestedCategoryId = _food.Id
        });
        Db.SaveChanges();
        await _sut.DeleteAsync(UserId, created.Id);
        Db.ChangeTracker.Clear();
        var log = Assert.Single(Db.CategorySuggestionLogs);
        Assert.Null(log.TransactionId);
    }

    // ---- GetPaged ----

    private void Seed(int count)
    {
        for (var i = 0; i < count; i++)
            AddTransaction(_account, _food, 10m + i, date: Jan15.AddDays(i), description: $"item {i}");
    }

    [Fact]
    public async Task GetPaged_ReturnsNewestFirst()
    {
        Seed(3);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery());
        Assert.Equal(["item 2", "item 1", "item 0"], result.Items.Select(t => t.Description));
    }

    [Fact]
    public async Task GetPaged_ReportsTotalCountAndPages()
    {
        Seed(25);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { PageSize = 10 });
        Assert.Equal(25, result.TotalCount);
        Assert.Equal(3, result.TotalPages);
        Assert.Equal(10, result.Items.Count);
    }

    [Fact]
    public async Task GetPaged_LastPageHoldsTheRemainder()
    {
        Seed(25);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { Page = 3, PageSize = 10 });
        Assert.Equal(5, result.Items.Count);
    }

    [Fact]
    public async Task GetPaged_PageBeyondEnd_IsEmpty()
    {
        Seed(3);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { Page = 5 });
        Assert.Empty(result.Items);
        Assert.Equal(3, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_OnlyReturnsOwnTransactions()
    {
        Seed(2);
        var theirs = AddAccount(OtherUserId, "Theirs");
        AddTransaction(theirs, AddCategory("X", userId: OtherUserId), 5m);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery());
        Assert.Equal(2, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_FiltersByFromDate()
    {
        Seed(5);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { From = Jan15.AddDays(3) });
        Assert.Equal(2, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_DateOnlyToIncludesTheWholeDay()
    {
        AddTransaction(_account, _food, 5m, date: Jan15.AddHours(18));
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { To = Jan15 });
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_ToExcludesNextDay()
    {
        AddTransaction(_account, _food, 5m, date: Jan15.AddDays(1));
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { To = Jan15 });
        Assert.Equal(0, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_FiltersByAccount()
    {
        var other = AddAccount(name: "Other");
        AddTransaction(_account, _food, 1m);
        AddTransaction(other, _food, 2m);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { AccountId = other.Id });
        Assert.Equal(2m, Assert.Single(result.Items).Amount);
    }

    [Fact]
    public async Task GetPaged_FiltersByCategory()
    {
        var transport = AddCategory("Transport");
        AddTransaction(_account, _food, 1m);
        AddTransaction(_account, transport, 2m);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { CategoryId = transport.Id });
        Assert.Equal("Transport", Assert.Single(result.Items).CategoryName);
    }

    [Fact]
    public async Task GetPaged_FiltersByType()
    {
        AddTransaction(_account, _food, 1m);
        AddTransaction(_account, _salary, 2m, TransactionType.Income);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { Type = TransactionType.Income });
        Assert.Equal(TransactionType.Income, Assert.Single(result.Items).Type);
    }

    [Fact]
    public async Task GetPaged_SearchMatchesDescription()
    {
        AddTransaction(_account, _food, 1m, description: "pho bo");
        AddTransaction(_account, _food, 2m, description: "banh mi");
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { Search = "pho" });
        Assert.Equal("pho bo", Assert.Single(result.Items).Description);
    }

    [Fact]
    public async Task GetPaged_BlankSearchIsIgnored()
    {
        Seed(3);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { Search = "   " });
        Assert.Equal(3, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_SearchTrimsInput()
    {
        AddTransaction(_account, _food, 1m, description: "pho bo");
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { Search = "  pho  " });
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_SearchSkipsTransactionsWithoutDescription()
    {
        AddTransaction(_account, _food, 1m);
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery { Search = "x" });
        Assert.Equal(0, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_CombinesFilters()
    {
        AddTransaction(_account, _food, 1m, date: Jan15, description: "pho");
        AddTransaction(_account, _food, 2m, date: Jan15.AddDays(10), description: "pho");
        var result = await _sut.GetPagedAsync(UserId,
            new TransactionQuery { Search = "pho", To = Jan15.AddDays(1), Type = TransactionType.Expense });
        Assert.Equal(1m, Assert.Single(result.Items).Amount);
    }

    [Fact]
    public async Task GetPaged_EmptyResult_HasZeroPages()
    {
        var result = await _sut.GetPagedAsync(UserId, new TransactionQuery());
        Assert.Equal(0, result.TotalPages);
        Assert.Empty(result.Items);
    }
}

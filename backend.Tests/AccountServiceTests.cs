using backend.DTOs.Requests;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;

namespace backend.Tests;

public class AccountServiceTests : DbTestBase
{
    private readonly AccountService _sut;

    public AccountServiceTests() => _sut = new AccountService(Db);

    // ---- Create ----

    [Fact]
    public async Task Create_ReturnsAccountWithInitialBalanceAsBalance()
    {
        var result = await _sut.CreateAsync(UserId, new CreateAccountRequest("Vi", AccountType.Bank, 500_000m));
        Assert.Equal(500_000m, result.Balance);
        Assert.Equal(500_000m, result.InitialBalance);
        Assert.Equal(0m, result.Contributed);
    }

    [Fact]
    public async Task Create_TrimsName()
    {
        var result = await _sut.CreateAsync(UserId, new CreateAccountRequest("  Vi chinh  ", AccountType.Cash, 0m));
        Assert.Equal("Vi chinh", result.Name);
    }

    [Theory]
    [InlineData("vnd", "VND")]
    [InlineData(" usd ", "USD")]
    [InlineData("Eur", "EUR")]
    [InlineData("VND", "VND")]
    public async Task Create_NormalizesCurrencyToUpperCase(string input, string expected)
    {
        var result = await _sut.CreateAsync(UserId, new CreateAccountRequest("A", AccountType.Cash, 0m, input));
        Assert.Equal(expected, result.Currency);
    }

    [Fact]
    public async Task Create_DefaultCurrencyIsVnd()
    {
        var result = await _sut.CreateAsync(UserId, new CreateAccountRequest("A", AccountType.Cash, 0m));
        Assert.Equal("VND", result.Currency);
    }

    [Theory]
    [InlineData(AccountType.Cash)]
    [InlineData(AccountType.Bank)]
    [InlineData(AccountType.EWallet)]
    public async Task Create_KeepsAccountType(AccountType type)
    {
        var result = await _sut.CreateAsync(UserId, new CreateAccountRequest("A", type, 0m));
        Assert.Equal(type, result.AccountType);
    }

    [Fact]
    public async Task Create_PersistsAccountForUser()
    {
        var result = await _sut.CreateAsync(UserId, new CreateAccountRequest("A", AccountType.Cash, 10m));
        var stored = Db.Accounts.Single(a => a.Id == result.Id);
        Assert.Equal(UserId, stored.UserId);
        Assert.False(stored.IsArchived);
    }

    [Fact]
    public async Task Create_DuplicateNameForSameUser_ThrowsConflict()
    {
        AddAccount(name: "Cash");
        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.CreateAsync(UserId, new CreateAccountRequest("Cash", AccountType.Cash, 0m)));
    }

    [Fact]
    public async Task Create_DuplicateNameAfterTrim_ThrowsConflict()
    {
        AddAccount(name: "Cash");
        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.CreateAsync(UserId, new CreateAccountRequest("  Cash ", AccountType.Cash, 0m)));
    }

    [Fact]
    public async Task Create_SameNameForDifferentUser_IsAllowed()
    {
        AddAccount(OtherUserId, "Cash");
        var result = await _sut.CreateAsync(UserId, new CreateAccountRequest("Cash", AccountType.Cash, 0m));
        Assert.Equal("Cash", result.Name);
    }

    [Fact]
    public async Task Create_SameNameAsArchivedAccount_IsAllowed()
    {
        AddAccount(name: "Old", archived: true);
        var result = await _sut.CreateAsync(UserId, new CreateAccountRequest("Old", AccountType.Cash, 0m));
        Assert.False(result.IsArchived);
    }

    [Fact]
    public async Task Create_NameComparisonIsCaseSensitiveInStorage()
    {
        AddAccount(name: "Cash");
        var result = await _sut.CreateAsync(UserId, new CreateAccountRequest("Cash2", AccountType.Cash, 0m));
        Assert.Equal("Cash2", result.Name);
    }

    // ---- GetAll ----

    [Fact]
    public async Task GetAll_ExcludesArchivedByDefault()
    {
        AddAccount(name: "A");
        AddAccount(name: "B", archived: true);
        var result = await _sut.GetAllAsync(UserId);
        Assert.Single(result);
        Assert.Equal("A", result[0].Name);
    }

    [Fact]
    public async Task GetAll_IncludesArchivedWhenRequested()
    {
        AddAccount(name: "A");
        AddAccount(name: "B", archived: true);
        var result = await _sut.GetAllAsync(UserId, includeArchived: true);
        Assert.Equal(2, result.Count);
    }

    [Fact]
    public async Task GetAll_ReturnsOnlyOwnAccounts()
    {
        AddAccount(name: "Mine");
        AddAccount(OtherUserId, "Theirs");
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(["Mine"], result.Select(a => a.Name));
    }

    [Fact]
    public async Task GetAll_WithNoAccounts_ReturnsEmpty()
    {
        Assert.Empty(await _sut.GetAllAsync(UserId));
    }

    [Fact]
    public async Task GetAll_OrdersByCreationTime()
    {
        var first = AddAccount(name: "First");
        var second = AddAccount(name: "Second");
        first.CreatedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        second.CreatedAt = new DateTime(2025, 2, 1, 0, 0, 0, DateTimeKind.Utc);
        Db.SaveChanges();
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(["First", "Second"], result.Select(a => a.Name));
    }

    [Fact]
    public async Task GetAll_BalanceAddsIncomeAndSubtractsExpense()
    {
        var account = AddAccount(initial: 1_000m);
        var food = AddCategory("Food");
        var salary = AddCategory("Salary", CategoryType.Income);
        AddTransaction(account, salary, 500m, TransactionType.Income);
        AddTransaction(account, food, 200m);
        AddTransaction(account, food, 100m);
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(1_200m, result[0].Balance);
    }

    [Fact]
    public async Task GetAll_BalanceSubtractsGoalContributions()
    {
        var account = AddAccount(initial: 1_000m);
        var goal = new FinancialGoal { UserId = UserId, Name = "G", TargetAmount = 5_000m };
        Db.FinancialGoals.Add(goal);
        Db.GoalContributions.Add(new GoalContribution { GoalId = goal.Id, AccountId = account.Id, Amount = 300m });
        Db.SaveChanges();
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(700m, result[0].Balance);
        Assert.Equal(300m, result[0].Contributed);
    }

    [Fact]
    public async Task GetAll_ContributionWithoutAccountDoesNotAffectBalance()
    {
        var account = AddAccount(initial: 1_000m);
        var goal = new FinancialGoal { UserId = UserId, Name = "G", TargetAmount = 5_000m };
        Db.FinancialGoals.Add(goal);
        Db.GoalContributions.Add(new GoalContribution { GoalId = goal.Id, AccountId = null, Amount = 300m });
        Db.SaveChanges();
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(1_000m, result[0].Balance);
    }

    [Fact]
    public async Task GetAll_BalanceIsPerAccount()
    {
        var a = AddAccount(name: "A", initial: 100m);
        var b = AddAccount(name: "B", initial: 100m);
        var food = AddCategory("Food");
        AddTransaction(a, food, 40m);
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(60m, result.Single(x => x.Id == a.Id).Balance);
        Assert.Equal(100m, result.Single(x => x.Id == b.Id).Balance);
    }

    [Fact]
    public async Task GetAll_BalanceCanBeNegative()
    {
        var account = AddAccount(initial: 100m);
        AddTransaction(account, AddCategory("Food"), 250m);
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(-150m, result[0].Balance);
    }

    // ---- GetById ----

    [Fact]
    public async Task GetById_ReturnsAccountWithBalance()
    {
        var account = AddAccount(initial: 50m);
        AddTransaction(account, AddCategory("Food"), 20m);
        var result = await _sut.GetByIdAsync(UserId, account.Id);
        Assert.Equal(30m, result.Balance);
        Assert.Equal(account.Name, result.Name);
    }

    [Fact]
    public async Task GetById_UnknownId_ThrowsNotFound()
    {
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(UserId, Guid.NewGuid()));
    }

    [Fact]
    public async Task GetById_AccountOfAnotherUser_ThrowsNotFound()
    {
        var account = AddAccount(OtherUserId, "Theirs");
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(UserId, account.Id));
    }

    [Fact]
    public async Task GetById_ArchivedAccountIsStillReturned()
    {
        var account = AddAccount(archived: true);
        var result = await _sut.GetByIdAsync(UserId, account.Id);
        Assert.True(result.IsArchived);
    }

    // ---- Update ----

    [Fact]
    public async Task Update_ChangesNameTypeAndArchiveFlag()
    {
        var account = AddAccount(name: "Old");
        var result = await _sut.UpdateAsync(UserId, account.Id, new UpdateAccountRequest("New", AccountType.Bank, true));
        Assert.Equal("New", result.Name);
        Assert.Equal(AccountType.Bank, result.AccountType);
        Assert.True(result.IsArchived);
    }

    [Fact]
    public async Task Update_TrimsName()
    {
        var account = AddAccount();
        var result = await _sut.UpdateAsync(UserId, account.Id, new UpdateAccountRequest("  X  ", AccountType.Cash, false));
        Assert.Equal("X", result.Name);
    }

    [Fact]
    public async Task Update_KeepingOwnNameIsAllowed()
    {
        var account = AddAccount(name: "Same");
        var result = await _sut.UpdateAsync(UserId, account.Id, new UpdateAccountRequest("Same", AccountType.Bank, false));
        Assert.Equal(AccountType.Bank, result.AccountType);
    }

    [Fact]
    public async Task Update_NameUsedByAnotherActiveAccount_ThrowsConflict()
    {
        AddAccount(name: "Taken");
        var account = AddAccount(name: "Mine");
        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.UpdateAsync(UserId, account.Id, new UpdateAccountRequest("Taken", AccountType.Cash, false)));
    }

    [Fact]
    public async Task Update_NameUsedByArchivedAccount_IsAllowed()
    {
        AddAccount(name: "Taken", archived: true);
        var account = AddAccount(name: "Mine");
        var result = await _sut.UpdateAsync(UserId, account.Id, new UpdateAccountRequest("Taken", AccountType.Cash, false));
        Assert.Equal("Taken", result.Name);
    }

    [Fact]
    public async Task Update_UnknownId_ThrowsNotFound()
    {
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.UpdateAsync(UserId, Guid.NewGuid(), new UpdateAccountRequest("X", AccountType.Cash, false)));
    }

    [Fact]
    public async Task Update_AccountOfAnotherUser_ThrowsNotFoundAndLeavesItUntouched()
    {
        var account = AddAccount(OtherUserId, "Theirs");
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.UpdateAsync(UserId, account.Id, new UpdateAccountRequest("Hacked", AccountType.Cash, true)));
        Assert.Equal("Theirs", Db.Accounts.AsEnumerable().Single(a => a.Id == account.Id).Name);
    }

    [Fact]
    public async Task Update_Unarchive_RestoresAccount()
    {
        var account = AddAccount(archived: true);
        var result = await _sut.UpdateAsync(UserId, account.Id, new UpdateAccountRequest("Cash", AccountType.Cash, false));
        Assert.False(result.IsArchived);
    }

    [Fact]
    public async Task Update_DoesNotChangeInitialBalanceOrCurrency()
    {
        var account = AddAccount(initial: 777m);
        var result = await _sut.UpdateAsync(UserId, account.Id, new UpdateAccountRequest("N", AccountType.Cash, false));
        Assert.Equal(777m, result.InitialBalance);
        Assert.Equal("VND", result.Currency);
    }

    // ---- Delete ----

    [Fact]
    public async Task Delete_AccountWithoutHistory_RemovesIt()
    {
        var account = AddAccount();
        await _sut.DeleteAsync(UserId, account.Id);
        Assert.False(Db.Accounts.Any(a => a.Id == account.Id));
    }

    [Fact]
    public async Task Delete_AccountWithTransactions_ArchivesInstead()
    {
        var account = AddAccount();
        AddTransaction(account, AddCategory("Food"), 10m);
        await _sut.DeleteAsync(UserId, account.Id);
        Db.ChangeTracker.Clear();
        Assert.True(Db.Accounts.Single(a => a.Id == account.Id).IsArchived);
    }

    [Fact]
    public async Task Delete_AccountWithGoalContributions_ArchivesInstead()
    {
        var account = AddAccount();
        var goal = new FinancialGoal { UserId = UserId, Name = "G", TargetAmount = 100m };
        Db.FinancialGoals.Add(goal);
        Db.GoalContributions.Add(new GoalContribution { GoalId = goal.Id, AccountId = account.Id, Amount = 5m });
        Db.SaveChanges();
        await _sut.DeleteAsync(UserId, account.Id);
        Db.ChangeTracker.Clear();
        Assert.True(Db.Accounts.Single(a => a.Id == account.Id).IsArchived);
    }

    [Fact]
    public async Task Delete_UnknownId_ThrowsNotFound()
    {
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, Guid.NewGuid()));
    }

    [Fact]
    public async Task Delete_AccountOfAnotherUser_ThrowsNotFoundAndKeepsIt()
    {
        var account = AddAccount(OtherUserId, "Theirs");
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, account.Id));
        Assert.True(Db.Accounts.Any(a => a.Id == account.Id));
    }

    [Fact]
    public async Task Delete_ArchivedAccountWithTransactions_StaysArchived()
    {
        var account = AddAccount(archived: true);
        AddTransaction(account, AddCategory("Food"), 10m);
        await _sut.DeleteAsync(UserId, account.Id);
        Db.ChangeTracker.Clear();
        Assert.True(Db.Accounts.Single(a => a.Id == account.Id).IsArchived);
    }

    [Fact]
    public async Task Delete_OtherAccountsAreUnaffected()
    {
        var keep = AddAccount(name: "Keep");
        var drop = AddAccount(name: "Drop");
        await _sut.DeleteAsync(UserId, drop.Id);
        Assert.Equal(["Keep"], Db.Accounts.Select(a => a.Name).ToList());
        Assert.Equal(keep.Id, Db.Accounts.Single().Id);
    }
}

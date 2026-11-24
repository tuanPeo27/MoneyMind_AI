using backend.DTOs.Requests;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;

namespace backend.Tests;

public class FinancialGoalServiceTests : DbTestBase
{
    private readonly FakeNotifications _notifications = new();
    private readonly FinancialGoalService _sut;

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    public FinancialGoalServiceTests() => _sut = new FinancialGoalService(Db, _notifications, TestCache.New());

    private FinancialGoal AddGoal(string name = "Trip", decimal target = 1_000m, decimal current = 0m,
        FinancialGoalStatus status = FinancialGoalStatus.Active, DateOnly? deadline = null, Guid? userId = null,
        byte? reminderDay = null)
    {
        var goal = new FinancialGoal
        {
            UserId = userId ?? UserId, Name = name, TargetAmount = target, CurrentAmount = current, Status = status,
            Deadline = deadline, ReminderDay = reminderDay
        };
        Db.FinancialGoals.Add(goal);
        Db.SaveChanges();
        return goal;
    }

    // ---- Create ----

    [Fact]
    public async Task Create_StartsActiveWithNothingSaved()
    {
        var result = await _sut.CreateAsync(UserId, new UpsertGoalRequest("Trip", 5_000m, null));
        Assert.Equal(FinancialGoalStatus.Active, result.Status);
        Assert.Equal(0m, result.CurrentAmount);
        Assert.Equal(0m, result.ProgressPercent);
        Assert.Equal(5_000m, result.TargetAmount);
    }

    [Fact]
    public async Task Create_TrimsName()
    {
        var result = await _sut.CreateAsync(UserId, new UpsertGoalRequest("  Trip  ", 5_000m, null));
        Assert.Equal("Trip", result.Name);
    }

    [Fact]
    public async Task Create_PastDeadline_ThrowsBadRequest()
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.CreateAsync(UserId, new UpsertGoalRequest("Trip", 5_000m, Today.AddDays(-1))));
    }

    [Fact]
    public async Task Create_DeadlineToday_IsAllowed()
    {
        var result = await _sut.CreateAsync(UserId, new UpsertGoalRequest("Trip", 5_000m, Today));
        Assert.Equal(Today, result.Deadline);
    }

    [Fact]
    public async Task Create_FutureDeadline_IsKept()
    {
        var result = await _sut.CreateAsync(UserId, new UpsertGoalRequest("Trip", 5_000m, Today.AddMonths(6)));
        Assert.Equal(Today.AddMonths(6), result.Deadline);
    }

    [Fact]
    public async Task Create_StoresReminderDay()
    {
        var result = await _sut.CreateAsync(UserId, new UpsertGoalRequest("Trip", 5_000m, null, 15));
        Assert.Equal((byte)15, result.ReminderDay);
    }

    [Fact]
    public async Task Create_BelongsToTheCaller()
    {
        var result = await _sut.CreateAsync(UserId, new UpsertGoalRequest("Trip", 5_000m, null));
        Assert.Equal(UserId, Db.FinancialGoals.Single(g => g.Id == result.Id).UserId);
    }

    // ---- Read ----

    [Fact]
    public async Task GetAll_ReturnsOnlyOwnGoals()
    {
        AddGoal();
        AddGoal(userId: OtherUserId);
        Assert.Single(await _sut.GetAllAsync(UserId));
    }

    [Fact]
    public async Task GetAll_FiltersByStatus()
    {
        AddGoal("A");
        AddGoal("B", status: FinancialGoalStatus.Completed);
        var result = await _sut.GetAllAsync(UserId, FinancialGoalStatus.Completed);
        Assert.Equal("B", Assert.Single(result).Name);
    }

    [Fact]
    public async Task GetAll_OrdersByDeadlineThenNameWithNoDeadlineLast()
    {
        AddGoal("NoDeadline");
        AddGoal("Later", deadline: Today.AddDays(30));
        AddGoal("Sooner", deadline: Today.AddDays(5));
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(["Sooner", "Later", "NoDeadline"], result.Select(g => g.Name));
    }

    [Fact]
    public async Task GetAll_SameDeadlineSortsByName()
    {
        var day = Today.AddDays(10);
        AddGoal("Beta", deadline: day);
        AddGoal("Alpha", deadline: day);
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(["Alpha", "Beta"], result.Select(g => g.Name));
    }

    [Fact]
    public async Task GetById_ReturnsGoal()
    {
        var goal = AddGoal("Car", 9_000m, 3_000m);
        var result = await _sut.GetByIdAsync(UserId, goal.Id);
        Assert.Equal("Car", result.Name);
        Assert.Equal(3_000m, result.CurrentAmount);
    }

    [Fact]
    public async Task GetById_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(UserId, Guid.NewGuid()));

    [Fact]
    public async Task GetById_OfAnotherUser_ThrowsNotFound()
    {
        var goal = AddGoal(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(UserId, goal.Id));
    }

    [Theory]
    [InlineData(0, 1000, 0)]
    [InlineData(250, 1000, 25)]
    [InlineData(1, 3, 33.33)]
    [InlineData(2, 3, 66.67)]
    [InlineData(1000, 1000, 100)]
    public async Task Progress_IsRoundedToTwoDecimals(int current, int target, double expected)
    {
        var goal = AddGoal(target: target, current: current);
        var result = await _sut.GetByIdAsync(UserId, goal.Id);
        Assert.Equal((decimal)expected, result.ProgressPercent);
    }

    [Fact]
    public async Task Progress_IsCappedAt100WhenOverTarget()
    {
        var goal = AddGoal(target: 1_000m, current: 2_500m, status: FinancialGoalStatus.Completed);
        Assert.Equal(100m, (await _sut.GetByIdAsync(UserId, goal.Id)).ProgressPercent);
    }

    // ---- Update ----

    [Fact]
    public async Task Update_ChangesNameTargetAndDeadline()
    {
        var goal = AddGoal();
        var result = await _sut.UpdateAsync(UserId, goal.Id, new UpsertGoalRequest(" New ", 2_000m, Today.AddDays(9)));
        Assert.Equal("New", result.Name);
        Assert.Equal(2_000m, result.TargetAmount);
        Assert.Equal(Today.AddDays(9), result.Deadline);
    }

    [Theory]
    [InlineData(FinancialGoalStatus.Completed)]
    [InlineData(FinancialGoalStatus.Cancelled)]
    public async Task Update_NonActiveGoal_ThrowsBadRequest(FinancialGoalStatus status)
    {
        var goal = AddGoal(status: status);
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.UpdateAsync(UserId, goal.Id, new UpsertGoalRequest("X", 1_000m, null)));
    }

    [Fact]
    public async Task Update_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.UpdateAsync(UserId, Guid.NewGuid(), new UpsertGoalRequest("X", 1_000m, null)));

    [Fact]
    public async Task Update_OfAnotherUser_ThrowsNotFound()
    {
        var goal = AddGoal(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.UpdateAsync(UserId, goal.Id, new UpsertGoalRequest("X", 1_000m, null)));
    }

    [Fact]
    public async Task Update_LoweringTargetToSavedAmount_CompletesGoalAndNotifies()
    {
        var goal = AddGoal(target: 1_000m, current: 600m);
        var result = await _sut.UpdateAsync(UserId, goal.Id, new UpsertGoalRequest("Trip", 500m, null));
        Assert.Equal(FinancialGoalStatus.Completed, result.Status);
        var sent = Assert.Single(_notifications.Created);
        Assert.Equal("Hoàn thành mục tiêu", sent.Title);
        Assert.Equal(NotificationSource.Goal, sent.Source);
        Assert.Equal("FinancialGoal", sent.RelatedType);
        Assert.Equal(goal.Id, sent.RelatedId);
    }

    [Fact]
    public async Task Update_TargetAboveSavedAmount_KeepsGoalActive()
    {
        var goal = AddGoal(target: 1_000m, current: 600m);
        var result = await _sut.UpdateAsync(UserId, goal.Id, new UpsertGoalRequest("Trip", 2_000m, null));
        Assert.Equal(FinancialGoalStatus.Active, result.Status);
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task Update_ChangingReminderDay_ResetsLastReminder()
    {
        var goal = AddGoal(reminderDay: 5);
        goal.LastReminderOn = Today;
        Db.SaveChanges();
        await _sut.UpdateAsync(UserId, goal.Id, new UpsertGoalRequest("Trip", 1_000m, null, 10));
        Db.ChangeTracker.Clear();
        Assert.Null(Db.FinancialGoals.Single(g => g.Id == goal.Id).LastReminderOn);
    }

    [Fact]
    public async Task Update_KeepingReminderDay_KeepsLastReminder()
    {
        var goal = AddGoal(reminderDay: 5);
        goal.LastReminderOn = Today;
        Db.SaveChanges();
        await _sut.UpdateAsync(UserId, goal.Id, new UpsertGoalRequest("Trip", 1_000m, null, 5));
        Db.ChangeTracker.Clear();
        Assert.Equal(Today, Db.FinancialGoals.Single(g => g.Id == goal.Id).LastReminderOn);
    }

    [Fact]
    public async Task Update_CanTurnReminderOff()
    {
        var goal = AddGoal(reminderDay: 5);
        var result = await _sut.UpdateAsync(UserId, goal.Id, new UpsertGoalRequest("Trip", 1_000m, null));
        Assert.Null(result.ReminderDay);
    }

    // ---- Contribute ----

    [Fact]
    public async Task Contribute_AddsToCurrentAmount()
    {
        var goal = AddGoal();
        var result = await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(300m));
        Assert.Equal(300m, result.CurrentAmount);
        Assert.Equal(30m, result.ProgressPercent);
    }

    [Fact]
    public async Task Contribute_AccumulatesAcrossCalls()
    {
        var goal = AddGoal();
        await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(100m));
        var result = await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(150m));
        Assert.Equal(250m, result.CurrentAmount);
        Assert.Equal(2, Db.GoalContributions.Count());
    }

    [Fact]
    public async Task Contribute_WithoutAccount_RecordsContributionWithNoAccount()
    {
        var goal = AddGoal();
        await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(100m));
        var contribution = Assert.Single(Db.GoalContributions);
        Assert.Null(contribution.AccountId);
        Assert.Equal(goal.Id, contribution.GoalId);
    }

    [Fact]
    public async Task Contribute_WithAccount_RecordsAccountOnContribution()
    {
        var goal = AddGoal();
        var account = AddAccount(initial: 1_000m);
        await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(100m, account.Id));
        Assert.Equal(account.Id, Assert.Single(Db.GoalContributions).AccountId);
    }

    [Fact]
    public async Task Contribute_MoreThanAccountBalance_ThrowsBadRequest()
    {
        var goal = AddGoal();
        var account = AddAccount(initial: 100m);
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(101m, account.Id)));
        Assert.Empty(Db.GoalContributions);
    }

    [Fact]
    public async Task Contribute_ExactlyTheAccountBalance_IsAllowed()
    {
        var goal = AddGoal();
        var account = AddAccount(initial: 100m);
        var result = await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(100m, account.Id));
        Assert.Equal(100m, result.CurrentAmount);
    }

    [Fact]
    public async Task Contribute_BalanceCountsIncomeAndExpenseTransactions()
    {
        var goal = AddGoal();
        var account = AddAccount(initial: 100m);
        AddTransaction(account, AddCategory("Salary", CategoryType.Income), 400m, TransactionType.Income);
        AddTransaction(account, AddCategory("Food"), 150m);
        // balance = 100 + 400 - 150 = 350
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(351m, account.Id)));
        var ok = await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(350m, account.Id));
        Assert.Equal(350m, ok.CurrentAmount);
    }

    [Fact]
    public async Task Contribute_BalanceDropsByEarlierContributions()
    {
        var goal = AddGoal(target: 10_000m);
        var account = AddAccount(initial: 500m);
        await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(400m, account.Id));
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(101m, account.Id)));
    }

    [Fact]
    public async Task Contribute_UnknownAccount_ThrowsNotFound()
    {
        var goal = AddGoal();
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(10m, Guid.NewGuid())));
    }

    [Fact]
    public async Task Contribute_AccountOfAnotherUser_ThrowsNotFound()
    {
        var goal = AddGoal();
        var theirs = AddAccount(OtherUserId, "Theirs");
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(10m, theirs.Id)));
    }

    [Fact]
    public async Task Contribute_ArchivedAccount_ThrowsBadRequest()
    {
        var goal = AddGoal();
        var archived = AddAccount(archived: true);
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(10m, archived.Id)));
    }

    [Theory]
    [InlineData(FinancialGoalStatus.Completed)]
    [InlineData(FinancialGoalStatus.Cancelled)]
    public async Task Contribute_NonActiveGoal_ThrowsBadRequest(FinancialGoalStatus status)
    {
        var goal = AddGoal(status: status);
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(10m)));
    }

    [Fact]
    public async Task Contribute_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.ContributeAsync(UserId, Guid.NewGuid(), new GoalContributionRequest(10m)));

    [Fact]
    public async Task Contribute_OfAnotherUsersGoal_ThrowsNotFound()
    {
        var goal = AddGoal(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(10m)));
    }

    [Fact]
    public async Task Contribute_ReachingTarget_CompletesGoalAndNotifies()
    {
        var goal = AddGoal(target: 1_000m, current: 900m);
        var result = await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(100m));
        Assert.Equal(FinancialGoalStatus.Completed, result.Status);
        Assert.Equal(100m, result.ProgressPercent);
        Assert.Equal("Hoàn thành mục tiêu", Assert.Single(_notifications.Created).Title);
    }

    [Fact]
    public async Task Contribute_ExceedingTarget_CompletesAndCapsProgress()
    {
        var goal = AddGoal(target: 1_000m, current: 900m);
        var result = await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(500m));
        Assert.Equal(1_400m, result.CurrentAmount);
        Assert.Equal(100m, result.ProgressPercent);
    }

    [Fact]
    public async Task Contribute_BelowTarget_DoesNotNotify()
    {
        var goal = AddGoal(target: 1_000m);
        await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(10m));
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task Contribute_ReducesAccountBalanceAsSeenByAccountService()
    {
        var goal = AddGoal();
        var account = AddAccount(initial: 1_000m);
        await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(250m, account.Id));
        var balance = (await new AccountService(Db).GetByIdAsync(UserId, account.Id)).Balance;
        Assert.Equal(750m, balance);
    }

    // ---- UpdateStatus ----

    [Theory]
    [InlineData(FinancialGoalStatus.Cancelled)]
    [InlineData(FinancialGoalStatus.Completed)]
    public async Task UpdateStatus_ChangesStatus(FinancialGoalStatus status)
    {
        var goal = AddGoal();
        var result = await _sut.UpdateStatusAsync(UserId, goal.Id, new UpdateGoalStatusRequest(status));
        Assert.Equal(status, result.Status);
    }

    [Fact]
    public async Task UpdateStatus_SameStatus_ReturnsGoalUnchanged()
    {
        var goal = AddGoal();
        var result = await _sut.UpdateStatusAsync(UserId, goal.Id, new UpdateGoalStatusRequest(FinancialGoalStatus.Active));
        Assert.Equal(FinancialGoalStatus.Active, result.Status);
    }

    [Fact]
    public async Task UpdateStatus_CancelledGoalCanBeReactivated()
    {
        var goal = AddGoal(status: FinancialGoalStatus.Cancelled);
        var result = await _sut.UpdateStatusAsync(UserId, goal.Id, new UpdateGoalStatusRequest(FinancialGoalStatus.Active));
        Assert.Equal(FinancialGoalStatus.Active, result.Status);
    }

    [Fact]
    public async Task UpdateStatus_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.UpdateStatusAsync(UserId, Guid.NewGuid(), new UpdateGoalStatusRequest(FinancialGoalStatus.Cancelled)));

    [Fact]
    public async Task UpdateStatus_OfAnotherUser_ThrowsNotFound()
    {
        var goal = AddGoal(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.UpdateStatusAsync(UserId, goal.Id, new UpdateGoalStatusRequest(FinancialGoalStatus.Cancelled)));
    }

    // ---- Delete ----

    [Fact]
    public async Task Delete_RemovesGoal()
    {
        var goal = AddGoal();
        await _sut.DeleteAsync(UserId, goal.Id);
        Assert.Empty(Db.FinancialGoals);
    }

    [Fact]
    public async Task Delete_RemovesContributionsAndReturnsMoneyToAccount()
    {
        var goal = AddGoal();
        var account = AddAccount(initial: 1_000m);
        await _sut.ContributeAsync(UserId, goal.Id, new GoalContributionRequest(400m, account.Id));
        await _sut.DeleteAsync(UserId, goal.Id);
        Assert.Empty(Db.GoalContributions);
        Assert.Equal(1_000m, (await new AccountService(Db).GetByIdAsync(UserId, account.Id)).Balance);
    }

    [Fact]
    public async Task Delete_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, Guid.NewGuid()));

    [Fact]
    public async Task Delete_OfAnotherUser_ThrowsNotFoundAndKeepsIt()
    {
        var goal = AddGoal(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, goal.Id));
        Assert.Single(Db.FinancialGoals);
    }
}

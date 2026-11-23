using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class FinancialGoalService(AppDbContext db, INotificationService notifications) : IFinancialGoalService
{
    public async Task<IReadOnlyList<FinancialGoalResponse>> GetAllAsync(Guid userId,
        FinancialGoalStatus? status = null, CancellationToken cancellationToken = default)
    {
        var query = db.FinancialGoals.AsNoTracking().Where(g => g.UserId == userId);
        if (status is not null) query = query.Where(g => g.Status == status);

        var goals = await query
            .OrderBy(g => g.Deadline == null).ThenBy(g => g.Deadline).ThenBy(g => g.Name)
            .ToListAsync(cancellationToken);
        return goals.Select(Map).ToList();
    }

    public async Task<FinancialGoalResponse> GetByIdAsync(Guid userId, Guid id,
        CancellationToken cancellationToken = default) =>
        Map(await FindAsync(userId, id, asNoTracking: true, cancellationToken));

    public async Task<FinancialGoalResponse> CreateAsync(Guid userId, UpsertGoalRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.Deadline is { } deadline && deadline < DateOnly.FromDateTime(DateTime.UtcNow))
            throw new BadRequestException("Hạn chót không được ở quá khứ.");

        var goal = new FinancialGoal
        {
            UserId = userId,
            Name = request.Name.Trim(),
            TargetAmount = request.TargetAmount,
            Deadline = request.Deadline,
            ReminderDay = request.ReminderDay
        };
        db.FinancialGoals.Add(goal);
        await db.SaveChangesAsync(cancellationToken);
        return Map(goal);
    }

    public async Task<FinancialGoalResponse> UpdateAsync(Guid userId, Guid id, UpsertGoalRequest request,
        CancellationToken cancellationToken = default)
    {
        var goal = await FindAsync(userId, id, asNoTracking: false, cancellationToken);
        if (goal.Status != FinancialGoalStatus.Active)
            throw new BadRequestException("Chỉ có thể sửa mục tiêu đang thực hiện.");

        goal.Name = request.Name.Trim();
        goal.TargetAmount = request.TargetAmount;
        goal.Deadline = request.Deadline;
        if (goal.ReminderDay != request.ReminderDay) goal.LastReminderOn = null; // a new reminder day may fire this month
        goal.ReminderDay = request.ReminderDay;

        var completed = goal.CurrentAmount >= goal.TargetAmount;
        if (completed) goal.Status = FinancialGoalStatus.Completed;

        await db.SaveChangesAsync(cancellationToken);
        if (completed) await NotifyCompletedAsync(goal, cancellationToken);
        return Map(goal);
    }

    public async Task<FinancialGoalResponse> ContributeAsync(Guid userId, Guid id, GoalContributionRequest request,
        CancellationToken cancellationToken = default)
    {
        var goal = await FindAsync(userId, id, asNoTracking: false, cancellationToken);
        if (goal.Status != FinancialGoalStatus.Active)
            throw new BadRequestException("Chỉ có thể đóng góp cho mục tiêu đang thực hiện.");

        if (request.AccountId is { } accountId)
        {
            var account = await db.Accounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == accountId && a.UserId == userId, cancellationToken)
                ?? throw new NotFoundException("Không tìm thấy tài khoản.");
            if (account.IsArchived) throw new BadRequestException("Tài khoản đã được lưu trữ.");
            var available = await AvailableBalanceAsync(userId, account, cancellationToken);
            if (request.Amount > available)
                throw new BadRequestException("Số dư tài khoản không đủ để góp số tiền này.");
        }

        goal.CurrentAmount += request.Amount;
        var completed = goal.CurrentAmount >= goal.TargetAmount;
        if (completed) goal.Status = FinancialGoalStatus.Completed;
        db.GoalContributions.Add(new GoalContribution { GoalId = goal.Id, AccountId = request.AccountId, Amount = request.Amount });

        await db.SaveChangesAsync(cancellationToken);
        if (completed) await NotifyCompletedAsync(goal, cancellationToken);
        return Map(goal);
    }

    public async Task<FinancialGoalResponse> UpdateStatusAsync(Guid userId, Guid id, UpdateGoalStatusRequest request,
        CancellationToken cancellationToken = default)
    {
        var goal = await FindAsync(userId, id, asNoTracking: false, cancellationToken);
        if (goal.Status == request.Status) return Map(goal);

        goal.Status = request.Status;
        await db.SaveChangesAsync(cancellationToken);
        return Map(goal);
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var deleted = await db.FinancialGoals
            .Where(g => g.Id == id && g.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        if (deleted == 0) throw new NotFoundException("Không tìm thấy mục tiêu.");
    }

    private async Task<FinancialGoal> FindAsync(Guid userId, Guid id, bool asNoTracking,
        CancellationToken cancellationToken)
    {
        var query = asNoTracking ? db.FinancialGoals.AsNoTracking() : db.FinancialGoals;
        return await query.FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy mục tiêu.");
    }

    /// <summary>Starting balance + income - expense - money already moved into savings goals.</summary>
    private async Task<decimal> AvailableBalanceAsync(Guid userId, Account account, CancellationToken cancellationToken)
    {
        var net = await db.Transactions.AsNoTracking()
            .Where(t => t.UserId == userId && t.AccountId == account.Id)
            .SumAsync(t => (decimal?)(t.Type == TransactionType.Income ? t.Amount : -t.Amount), cancellationToken) ?? 0m;
        var contributed = await db.GoalContributions.AsNoTracking()
            .Where(c => c.AccountId == account.Id)
            .SumAsync(c => (decimal?)c.Amount, cancellationToken) ?? 0m;
        return account.InitialBalance + net - contributed;
    }

    private Task NotifyCompletedAsync(FinancialGoal goal, CancellationToken cancellationToken) =>
        notifications.CreateAsync(goal.UserId, NotificationType.Info, NotificationSource.Goal,
            "Hoàn thành mục tiêu",
            $"Chúc mừng! Bạn đã đạt mục tiêu \"{goal.Name}\".",
            "FinancialGoal", goal.Id, cancellationToken);

    private static FinancialGoalResponse Map(FinancialGoal g)
    {
        var progress = g.TargetAmount > 0
            ? Math.Min(100m, Math.Round(g.CurrentAmount / g.TargetAmount * 100m, 2))
            : 0m;
        return new FinancialGoalResponse(g.Id, g.Name, g.TargetAmount, g.CurrentAmount, progress, g.Deadline,
            g.Status, g.ReminderDay);
    }
}

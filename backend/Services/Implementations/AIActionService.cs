using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using backend.Data;
using backend.DTOs;
using backend.DTOs.Requests;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class AIActionService(
    AppDbContext db,
    IEncryptionService encryption,
    ITransactionService transactions,
    IAccountService accounts,
    ICategoryService categories,
    IBudgetService budgets,
    IFinancialGoalService goals) : IAIActionService
{
    private const decimal MaxAmount = 999_999_999_999_999m;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private sealed record Item(Guid Id, string Name, CategoryType? Type = null);

    private sealed record Lookup(IReadOnlyList<Item> Categories, IReadOnlyList<Item> Accounts, IReadOnlyList<Item> Goals,
        DateOnly Today);

    // ---- propose ----

    public async Task<IReadOnlyList<AIActionResponse>> ProposeAsync(Guid userId, Guid messageId,
        IReadOnlyList<AIProposedAction> proposals, CancellationToken cancellationToken = default)
    {
        var accepted = proposals.Where(p => AIActionTypes.All.Contains(p.Name)).Take(AIActionTypes.MaxPerMessage).ToList();
        if (accepted.Count == 0) return [];

        var lookup = await LoadLookupAsync(userId, cancellationToken);
        // A bank or wallet is an account. Drop a category the model named after an existing account or one it
        // proposes in this same reply (it used to create a "Vietcombank" category instead of an account).
        var accountNames = lookup.Accounts.Select(a => Fold(a.Name))
            .Concat(accepted.Where(p => p.Name == AIActionTypes.CreateAccount).Select(p => Fold(Str(p.Args, "name") ?? "")))
            .Where(n => n.Length > 0).ToHashSet();
        accepted = accepted.Where(p => p.Name != AIActionTypes.CreateCategory
            || !accountNames.Contains(Fold(Str(p.Args, "name") ?? ""))).ToList();
        if (accepted.Count == 0) return [];
        var responses = new List<AIActionResponse>(accepted.Count);
        foreach (var proposal in accepted)
        {
            var payload = Normalize(proposal.Name, proposal.Args, lookup);
            if (proposal.Name == AIActionTypes.ProposeBudgets)
            {
                payload = await PrepareBudgetProposalAsync(userId, payload, lookup, cancellationToken);
                // Nothing left after the checks (unknown categories, budgets that already exist): no empty card.
                if (payload.Budgets is not { Count: > 0 }) continue;
            }
            var entity = new AIAction { UserId = userId, MessageId = messageId, ActionType = proposal.Name };
            await WritePayloadAsync(entity, payload, cancellationToken);
            db.AIActions.Add(entity);
            responses.Add(Map(entity, payload));
        }
        return responses;
    }

    public async Task<IReadOnlyDictionary<Guid, IReadOnlyList<AIActionResponse>>> GetForMessagesAsync(Guid userId,
        IReadOnlyCollection<Guid> messageIds, CancellationToken cancellationToken = default)
    {
        if (messageIds.Count == 0) return new Dictionary<Guid, IReadOnlyList<AIActionResponse>>();

        var rows = await db.AIActions.AsNoTracking()
            .Where(a => a.UserId == userId && messageIds.Contains(a.MessageId))
            .OrderBy(a => a.CreatedAt)
            .ToListAsync(cancellationToken);

        var result = new Dictionary<Guid, IReadOnlyList<AIActionResponse>>();
        foreach (var group in rows.GroupBy(a => a.MessageId))
        {
            var list = new List<AIActionResponse>();
            foreach (var row in group) list.Add(Map(row, await ReadPayloadAsync(row, cancellationToken)));
            result[group.Key] = list;
        }
        return result;
    }

    // ---- confirm / cancel ----

    public async Task<AIActionResponse> ConfirmAsync(Guid userId, Guid actionId, AIActionPayload? edited,
        CancellationToken cancellationToken = default)
    {
        // Claim the action first. Two clicks (or two tabs) cannot both pass this, so it is carried out only once.
        var now = DateTime.UtcNow;
        var claimed = await db.AIActions
            .Where(a => a.Id == actionId && a.UserId == userId && a.Status == AIActionStatus.Pending)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, AIActionStatus.Confirmed)
                .SetProperty(a => a.ResolvedAt, (DateTime?)now), cancellationToken);
        if (claimed == 0) throw await NotPendingAsync(userId, actionId, cancellationToken);

        var action = await db.AIActions.FirstAsync(a => a.Id == actionId, cancellationToken);
        AIActionPayload payload;
        Guid resultId;
        try
        {
            var lookup = await LoadLookupAsync(userId, cancellationToken);
            var stored = await ReadPayloadAsync(action, cancellationToken);
            payload = action.ActionType == AIActionTypes.ProposeBudgets
                // The user may only keep, drop and re-price the proposed categories; everything else stays as stored.
                ? SelectBudgets(stored, edited, lookup)
                // Names are matched again: a category proposed in the same reply may have been created since.
                : Resolve(action.ActionType, edited ?? stored, lookup);
            (resultId, payload) = await ExecuteAsync(userId, action.ActionType, payload, lookup, cancellationToken);
        }
        catch
        {
            // Not carried out: give it back to the user to fix and try again.
            await db.AIActions.Where(a => a.Id == actionId)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, AIActionStatus.Pending)
                    .SetProperty(a => a.ResolvedAt, (DateTime?)null), CancellationToken.None);
            throw;
        }

        action.ResultId = resultId;
        await WritePayloadAsync(action, payload, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Map(action, payload);
    }

    public async Task<AIActionResponse> CancelAsync(Guid userId, Guid actionId, CancellationToken cancellationToken = default)
    {
        var updated = await db.AIActions
            .Where(a => a.Id == actionId && a.UserId == userId && a.Status == AIActionStatus.Pending)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, AIActionStatus.Cancelled)
                .SetProperty(a => a.ResolvedAt, (DateTime?)DateTime.UtcNow), cancellationToken);
        if (updated == 0) throw await NotPendingAsync(userId, actionId, cancellationToken);

        var action = await db.AIActions.AsNoTracking().FirstAsync(a => a.Id == actionId, cancellationToken);
        return Map(action, await ReadPayloadAsync(action, cancellationToken));
    }

    private async Task<AppException> NotPendingAsync(Guid userId, Guid actionId, CancellationToken cancellationToken) =>
        await db.AIActions.AnyAsync(a => a.Id == actionId && a.UserId == userId, cancellationToken)
            ? new ConflictException("Thao tác này đã được xử lý.")
            : new NotFoundException("Không tìm thấy thao tác.");

    /// <summary>Carries the action out. Returns the created record's id and the payload as saved.</summary>
    private async Task<(Guid Id, AIActionPayload Payload)> ExecuteAsync(Guid userId, string type, AIActionPayload p, Lookup lookup,
        CancellationToken cancellationToken)
    {
        switch (type)
        {
            case AIActionTypes.CreateTransaction:
            {
                var kind = RequireType(p.Type);
                var request = new UpsertTransactionRequest(
                    p.AccountId ?? throw new BadRequestException("Hãy chọn tài khoản."),
                    p.CategoryId ?? throw new BadRequestException("Hãy chọn danh mục."),
                    RequireAmount(p.Amount),
                    kind == CategoryType.Income ? TransactionType.Income : TransactionType.Expense,
                    Clip(p.Description, 500),
                    // Same time of day the web app uses for a date-only transaction.
                    (p.Date ?? lookup.Today).ToDateTime(new TimeOnly(12, 0), DateTimeKind.Utc),
                    TransactionSource.AIDraft);
                return ((await transactions.CreateAsync(userId, request, cancellationToken)).Id, p);
            }
            case AIActionTypes.CreateAccount:
            {
                var balance = p.InitialBalance ?? 0m;
                if (balance is < 0 or > MaxAmount) throw new BadRequestException("Số dư ban đầu không hợp lệ.");
                var request = new CreateAccountRequest(RequireText(p.Name, 100, "Hãy nhập tên tài khoản."),
                    ParseAccountType(p.AccountType) ?? throw new BadRequestException("Hãy chọn loại tài khoản."), balance);
                return ((await accounts.CreateAsync(userId, request, cancellationToken)).Id, p);
            }
            case AIActionTypes.CreateCategory:
            {
                var request = new UpsertCategoryRequest(RequireText(p.Name, 100, "Hãy nhập tên danh mục."),
                    RequireType(p.Type), null, null);
                return ((await categories.CreateAsync(userId, request, cancellationToken)).Id, p);
            }
            case AIActionTypes.CreateBudget:
            {
                var threshold = p.AlertThreshold ?? 80;
                if (threshold is < 1 or > 100) throw new BadRequestException("Ngưỡng cảnh báo phải từ 1 đến 100%.");
                var request = new UpsertBudgetRequest(
                    p.CategoryId ?? throw new BadRequestException("Hãy chọn danh mục chi tiêu."),
                    RequireAmount(p.Amount),
                    p.StartDate ?? throw new BadRequestException("Hãy chọn ngày bắt đầu."),
                    p.EndDate ?? throw new BadRequestException("Hãy chọn ngày kết thúc."),
                    threshold);
                return ((await budgets.CreateAsync(userId, request, cancellationToken)).Id, p);
            }
            case AIActionTypes.ProposeBudgets:
            {
                var (start, end) = BudgetPeriod.Require(p.Period, lookup.Today);
                var items = p.Budgets ?? [];
                if (items.Count == 0) throw new BadRequestException("Hãy chọn ít nhất một danh mục.");
                var requests = items.Select(i => new UpsertBudgetRequest(
                    i.CategoryId ?? throw new BadRequestException("Hãy chọn danh mục chi tiêu."),
                    RequireAmount(i.Amount), start, end)).ToList();
                // One transaction: every selected budget is created, or none.
                var created = await budgets.CreateManyAsync(userId, requests, cancellationToken);
                var saved = items.Select(i => i with { BudgetId = created.First(c => c.CategoryId == i.CategoryId).Id }).ToList();
                return (created[0].Id, p with { Budgets = saved });
            }
            case AIActionTypes.CreateSavingsGoal:
            {
                var request = new UpsertGoalRequest(RequireText(p.Name, 150, "Hãy nhập tên quỹ."),
                    RequireAmount(p.TargetAmount), p.Deadline);
                return ((await goals.CreateAsync(userId, request, cancellationToken)).Id, p);
            }
            case AIActionTypes.ContributeToGoal:
            {
                var goalId = p.GoalId ?? throw new BadRequestException("Hãy chọn quỹ tiết kiệm.");
                await goals.ContributeAsync(userId, goalId, new GoalContributionRequest(RequireAmount(p.Amount), p.AccountId),
                    cancellationToken);
                return (goalId, p);
            }
            default:
                throw new BadRequestException("Loại thao tác không được hỗ trợ.");
        }
    }

    // ---- normalizing the model's arguments ----

    private static AIActionPayload Normalize(string type, JsonElement args, Lookup lookup) => type switch
    {
        AIActionTypes.CreateTransaction => Resolve(type, new AIActionPayload(
            Type: ParseType(Str(args, "type"))?.ToString() ?? nameof(CategoryType.Expense),
            Amount: Num(args, "amount"),
            CategoryName: Str(args, "category"),
            AccountName: Str(args, "account"),
            Date: Day(args, "date") ?? lookup.Today,
            Description: Clip(Str(args, "description"), 500)), lookup),
        AIActionTypes.CreateAccount => new AIActionPayload(
            Name: Clip(Str(args, "name"), 100),
            AccountType: (ParseAccountType(Str(args, "account_type")) ?? GuessAccountType(Str(args, "name"))).ToString(),
            InitialBalance: Num(args, "initial_balance") is { } initial && initial >= 0 ? initial : 0m),
        AIActionTypes.CreateCategory => new AIActionPayload(
            Type: ParseType(Str(args, "type"))?.ToString() ?? nameof(CategoryType.Expense),
            Name: Clip(Str(args, "name"), 100)),
        AIActionTypes.CreateBudget => Resolve(type, new AIActionPayload(
            Amount: Num(args, "amount"),
            CategoryName: Str(args, "category"),
            StartDate: Day(args, "start_date") ?? new DateOnly(lookup.Today.Year, lookup.Today.Month, 1),
            EndDate: Day(args, "end_date") ?? new DateOnly(lookup.Today.Year, lookup.Today.Month, 1).AddMonths(1).AddDays(-1),
            AlertThreshold: (byte)Math.Clamp(Int(args, "alert_threshold") ?? 80, 1, 100)), lookup),
        AIActionTypes.CreateSavingsGoal => new AIActionPayload(
            Name: Clip(Str(args, "name"), 150),
            TargetAmount: Num(args, "target_amount"),
            Deadline: Day(args, "deadline")),
        AIActionTypes.ContributeToGoal => Resolve(type, new AIActionPayload(
            Amount: Num(args, "amount"),
            GoalName: Str(args, "goal"),
            AccountName: Str(args, "account")), lookup),
        AIActionTypes.ProposeBudgets => NormalizeBudgetProposal(args, lookup),
        _ => new AIActionPayload()
    };

    /// <summary>
    /// The model's budget list, kept only where it names one of the user's active expense categories (by id, or by
    /// exact name as a fallback). Unknown ids, duplicates and missing or invalid amounts are dropped: the AI cannot add
    /// a category or an amount the user did not get from it in the card.
    /// </summary>
    private static AIActionPayload NormalizeBudgetProposal(JsonElement args, Lookup lookup)
    {
        var expense = lookup.Categories.Where(c => c.Type == CategoryType.Expense).ToList();
        var thisMonth = new DateOnly(lookup.Today.Year, lookup.Today.Month, 1);
        // A period that is missing, malformed, in the past or too far ahead becomes the current month.
        var start = BudgetPeriod.TryParse(Str(args, "period"), out var parsed, out _)
            && parsed >= thisMonth && parsed <= thisMonth.AddMonths(BudgetPeriod.MaxMonthsAhead) ? parsed : thisMonth;

        var items = new List<AIBudgetProposalItem>();
        if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("budgets", out var list) && list.ValueKind == JsonValueKind.Array)
            foreach (var element in list.EnumerateArray())
            {
                if (items.Count == AIActionTypes.MaxBudgetItems) break;
                var id = Guid.TryParse(Str(element, "category_id"), out var g) ? g : (Guid?)null;
                var category = (id is { } wanted ? expense.FirstOrDefault(c => c.Id == wanted) : null) ?? Match(expense, Str(element, "category"));
                if (category is null || items.Any(i => i.CategoryId == category.Id)) continue;
                var amount = Num(element, "amount");
                if (amount is not > 0 || amount > MaxAmount) continue;
                items.Add(new AIBudgetProposalItem(category.Id, category.Name, Math.Round(amount.Value, 0), Clip(Str(element, "reason"), 200)));
            }

        return new AIActionPayload(Period: BudgetPeriod.Format(start), Summary: Clip(Str(args, "summary"), 300), Budgets: items);
    }

    /// <summary>
    /// Leaves out categories that already have a budget overlapping the period (nothing is created twice or overwritten),
    /// then adds what each amount can be compared with: the category's average over the last full months with any
    /// spending (up to 3) and its spending so far this month, both from the database.
    /// </summary>
    private async Task<AIActionPayload> PrepareBudgetProposalAsync(Guid userId, AIActionPayload p, Lookup lookup,
        CancellationToken cancellationToken)
    {
        var items = p.Budgets ?? [];
        if (items.Count == 0 || !BudgetPeriod.TryParse(p.Period, out var start, out var end)) return p with { Budgets = [] };

        var ids = items.Select(i => i.CategoryId!.Value).ToList();
        var taken = await db.Budgets.AsNoTracking()
            .Where(b => b.UserId == userId && ids.Contains(b.CategoryId) && b.StartDate <= end && b.EndDate >= start)
            .Select(b => b.CategoryId).Distinct().ToListAsync(cancellationToken);
        // Named on the card, so the user knows why a category the AI mentioned is not in the list.
        var skipped = items.Where(i => taken.Contains(i.CategoryId!.Value)).Select(i => i.CategoryName!).ToList();
        items = items.Where(i => !taken.Contains(i.CategoryId!.Value)).ToList();
        p = p with { SkippedCategories = skipped.Count > 0 ? skipped : null };
        if (items.Count == 0) return p with { Budgets = items };

        var thisMonth = new DateOnly(lookup.Today.Year, lookup.Today.Month, 1);
        var from = DateRange.StartOfDay(thisMonth.AddMonths(-3));
        var to = DateRange.StartOfDay(thisMonth.AddMonths(1));
        var rows = await db.Transactions.AsNoTracking()
            .Where(t => t.UserId == userId && t.Type == TransactionType.Expense && t.TransactionDate >= from && t.TransactionDate < to)
            .GroupBy(t => new { t.CategoryId, t.TransactionDate.Year, t.TransactionDate.Month })
            .Select(g => new { g.Key.CategoryId, Month = g.Key.Year * 12 + g.Key.Month, Amount = g.Sum(t => t.Amount) })
            .ToListAsync(cancellationToken);
        var current = thisMonth.Year * 12 + thisMonth.Month;
        // Full months in which the user recorded any expense: someone who started last month has one month, not three.
        var months = rows.Where(r => r.Month < current).Select(r => r.Month).Distinct().Count();

        return p with
        {
            Budgets = items.Select(i =>
            {
                var mine = rows.Where(r => r.CategoryId == i.CategoryId).ToList();
                return i with
                {
                    AverageSpent = months > 0 ? Math.Round(mine.Where(r => r.Month < current).Sum(r => r.Amount) / months, 0) : null,
                    HistoryMonths = months,
                    CurrentSpent = mine.Where(r => r.Month == current).Sum(r => r.Amount),
                };
            }).ToList()
        };
    }

    /// <summary>
    /// The categories the user kept, with their (possibly edited) amounts. Only categories from the stored proposal are
    /// accepted, each once; names, reasons, history figures and the period come from the stored proposal.
    /// </summary>
    private static AIActionPayload SelectBudgets(AIActionPayload stored, AIActionPayload? edited, Lookup lookup)
    {
        var proposed = stored.Budgets ?? [];
        var chosen = edited is null ? proposed : edited.Budgets ?? [];
        if (chosen.Count == 0) throw new BadRequestException("Hãy chọn ít nhất một danh mục.");

        var result = new List<AIBudgetProposalItem>(chosen.Count);
        foreach (var item in chosen)
        {
            var original = proposed.FirstOrDefault(o => o.CategoryId == item.CategoryId)
                ?? throw new BadRequestException("Chỉ tạo được ngân sách cho các danh mục trong đề xuất.");
            if (result.Any(r => r.CategoryId == item.CategoryId))
                throw new BadRequestException($"Danh mục {original.CategoryName} bị trùng.");
            if (!lookup.Categories.Any(c => c.Id == item.CategoryId && c.Type == CategoryType.Expense))
                throw new BadRequestException($"Danh mục {original.CategoryName} không còn dùng được.");
            result.Add(original with { Amount = item.Amount });
        }
        return stored with { Budgets = result };
    }

    /// <summary>Fills missing ids by matching names to the user's records. Ids already set are kept.</summary>
    private static AIActionPayload Resolve(string type, AIActionPayload p, Lookup lookup)
    {
        switch (type)
        {
            case AIActionTypes.CreateTransaction:
            {
                var kind = ParseType(p.Type) ?? CategoryType.Expense;
                var category = p.CategoryId is null ? Match(lookup.Categories.Where(c => c.Type == kind), p.CategoryName) : null;
                // With a single account there is nothing to choose; otherwise the user picks one on the card.
                var account = p.AccountId is null
                    ? Match(lookup.Accounts, p.AccountName) ?? (p.AccountName is null && lookup.Accounts.Count == 1 ? lookup.Accounts[0] : null)
                    : null;
                return p with
                {
                    CategoryId = p.CategoryId ?? category?.Id, CategoryName = category?.Name ?? p.CategoryName,
                    AccountId = p.AccountId ?? account?.Id, AccountName = account?.Name ?? p.AccountName
                };
            }
            case AIActionTypes.CreateBudget:
            {
                var category = p.CategoryId is null
                    ? Match(lookup.Categories.Where(c => c.Type == CategoryType.Expense), p.CategoryName) : null;
                return p with { CategoryId = p.CategoryId ?? category?.Id, CategoryName = category?.Name ?? p.CategoryName };
            }
            case AIActionTypes.ContributeToGoal:
            {
                var goal = p.GoalId is null ? Match(lookup.Goals, p.GoalName) : null;
                var account = p.AccountId is null ? Match(lookup.Accounts, p.AccountName) : null;
                return p with
                {
                    GoalId = p.GoalId ?? goal?.Id, GoalName = goal?.Name ?? p.GoalName,
                    AccountId = p.AccountId ?? account?.Id, AccountName = account?.Name ?? p.AccountName
                };
            }
            default:
                return p;
        }
    }

    private async Task<Lookup> LoadLookupAsync(Guid userId, CancellationToken cancellationToken)
    {
        // The user's own categories come first, so they win over a system category with the same name.
        var categoryRows = await db.Categories.AsNoTracking()
            .Where(c => c.IsActive && (c.IsSystem || c.UserId == userId))
            .OrderBy(c => c.IsSystem).ThenBy(c => c.Name)
            .Select(c => new Item(c.Id, c.Name, c.Type))
            .ToListAsync(cancellationToken);
        var accountRows = await db.Accounts.AsNoTracking()
            .Where(a => a.UserId == userId && !a.IsArchived)
            .OrderBy(a => a.CreatedAt)
            .Select(a => new Item(a.Id, a.Name, null))
            .ToListAsync(cancellationToken);
        var goalRows = await db.FinancialGoals.AsNoTracking()
            .Where(g => g.UserId == userId && g.Status == FinancialGoalStatus.Active)
            .Select(g => new Item(g.Id, g.Name, null))
            .ToListAsync(cancellationToken);
        var timeZoneId = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.TimeZoneId)
            .FirstOrDefaultAsync(cancellationToken) ?? "UTC";

        return new Lookup(categoryRows, accountRows, goalRows, FinancialAnalysisService.LocalToday(timeZoneId));
    }

    /// <summary>Exact name first (ignoring case), then the same name without Vietnamese accents.</summary>
    private static Item? Match(IEnumerable<Item> items, string? wanted)
    {
        if (string.IsNullOrWhiteSpace(wanted)) return null;
        var list = items as IList<Item> ?? items.ToList();
        var exact = wanted.Trim();
        var folded = Fold(exact);
        return list.FirstOrDefault(i => string.Equals(i.Name.Trim(), exact, StringComparison.OrdinalIgnoreCase))
            ?? list.FirstOrDefault(i => Fold(i.Name) == folded);
    }

    private static string Fold(string value) => TextFold.Fold(value);

    private static string? Str(JsonElement args, string name) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(value.GetString()) ? value.GetString()!.Trim() : null;

    private static decimal? Num(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number)) return number;
        return value.ValueKind == JsonValueKind.String
            && decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    private static int? Int(JsonElement args, string name) => Num(args, name) is { } value ? (int)Math.Round(value) : null;

    private static DateOnly? Day(JsonElement args, string name) =>
        DateOnly.TryParseExact(Str(args, name), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)
            ? day : null;

    private static CategoryType? ParseType(string? value) =>
        Enum.TryParse<CategoryType>(value, ignoreCase: true, out var type) && Enum.IsDefined(type) ? type : null;

    private static AccountType? ParseAccountType(string? value) =>
        Enum.TryParse<AccountType>(value, ignoreCase: true, out var type) && Enum.IsDefined(type) ? type : null;

    private static readonly string[] WalletWords = ["momo", "zalopay", "zalo pay", "vnpay", "shopeepay", "viettel money"];

    /// <summary>When the model leaves the type out: "MoMo" is a wallet, "Tiền mặt" is cash, anything else a bank.</summary>
    private static AccountType GuessAccountType(string? name)
    {
        var folded = Fold(name ?? "");
        if (folded.StartsWith("tien mat") || folded.StartsWith("cash")) return AccountType.Cash;
        return WalletWords.Any(folded.Contains) || folded.StartsWith("vi ") ? AccountType.EWallet : AccountType.Bank;
    }

    private static CategoryType RequireType(string? value) =>
        ParseType(value) ?? throw new BadRequestException("Loại phải là Chi tiêu hoặc Thu nhập.");

    private static decimal RequireAmount(decimal? amount) => amount switch
    {
        null => throw new BadRequestException("Hãy nhập số tiền."),
        <= 0 => throw new BadRequestException("Số tiền phải lớn hơn 0."),
        > MaxAmount => throw new BadRequestException("Số tiền quá lớn."),
        _ => amount.Value
    };

    private static string RequireText(string? value, int max, string message) =>
        string.IsNullOrWhiteSpace(value) ? throw new BadRequestException(message)
        : value.Trim().Length > max ? throw new BadRequestException($"Tối đa {max} ký tự.") : value.Trim();

    private static string? Clip(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim() is var text && text.Length > max ? text[..max] : value.Trim();

    // ---- storage ----

    private async Task WritePayloadAsync(AIAction entity, AIActionPayload payload, CancellationToken cancellationToken)
    {
        var encrypted = await encryption.EncryptAsync(entity.UserId, JsonSerializer.Serialize(payload, Json), cancellationToken);
        entity.PayloadCipher = encrypted.Cipher;
        entity.PayloadNonce = encrypted.Nonce;
        entity.KeyVersion = encrypted.KeyVersion;
    }

    private async Task<AIActionPayload> ReadPayloadAsync(AIAction entity, CancellationToken cancellationToken)
    {
        var json = await encryption.DecryptAsync(entity.UserId, entity.PayloadCipher, entity.PayloadNonce, entity.KeyVersion,
            cancellationToken);
        return JsonSerializer.Deserialize<AIActionPayload>(json, Json) ?? new AIActionPayload();
    }

    private static AIActionResponse Map(AIAction a, AIActionPayload payload) =>
        new(a.Id, a.ActionType, a.Status, payload, a.ResultId, AsUtc(a.CreatedAt), a.ResolvedAt is { } at ? AsUtc(at) : null);

    private static DateTime AsUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    /// <summary>One line per action, appended to the assistant turn in the history the model sees.</summary>
    public static string DescribeForHistory(AIActionResponse action) =>
        $"[{action.Type} {JsonSerializer.Serialize(action.Payload, Json)} → {action.Status}]";
}

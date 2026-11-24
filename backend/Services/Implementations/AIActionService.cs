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
        var responses = new List<AIActionResponse>(accepted.Count);
        foreach (var proposal in accepted)
        {
            var payload = Normalize(proposal.Name, proposal.Args, lookup);
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
            // Names are matched again: a category proposed in the same reply may have been created since.
            payload = Resolve(action.ActionType, edited ?? await ReadPayloadAsync(action, cancellationToken), lookup);
            resultId = await ExecuteAsync(userId, action.ActionType, payload, lookup, cancellationToken);
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

    private async Task<Guid> ExecuteAsync(Guid userId, string type, AIActionPayload p, Lookup lookup,
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
                return (await transactions.CreateAsync(userId, request, cancellationToken)).Id;
            }
            case AIActionTypes.CreateCategory:
            {
                var request = new UpsertCategoryRequest(RequireText(p.Name, 100, "Hãy nhập tên danh mục."),
                    RequireType(p.Type), null, null);
                return (await categories.CreateAsync(userId, request, cancellationToken)).Id;
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
                return (await budgets.CreateAsync(userId, request, cancellationToken)).Id;
            }
            case AIActionTypes.CreateSavingsGoal:
            {
                var request = new UpsertGoalRequest(RequireText(p.Name, 150, "Hãy nhập tên quỹ."),
                    RequireAmount(p.TargetAmount), p.Deadline);
                return (await goals.CreateAsync(userId, request, cancellationToken)).Id;
            }
            case AIActionTypes.ContributeToGoal:
            {
                var goalId = p.GoalId ?? throw new BadRequestException("Hãy chọn quỹ tiết kiệm.");
                await goals.ContributeAsync(userId, goalId, new GoalContributionRequest(RequireAmount(p.Amount), p.AccountId),
                    cancellationToken);
                return goalId;
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
        _ => new AIActionPayload()
    };

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

    private static string Fold(string value)
    {
        var decomposed = value.Trim().ToLowerInvariant().Replace('đ', 'd').Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) builder.Append(ch);
        return string.Join(' ', builder.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

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

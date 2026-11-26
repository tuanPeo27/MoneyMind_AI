using backend.Data;
using backend.DTOs;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace backend.Services.Implementations;

/// <summary>
/// Suggests a category for a transaction description, cheapest source first:
/// 1. the user's own history (same description, or one containing the other), which also learns from corrections
///    because saved transactions carry the category the user finally chose;
/// 2. keyword rules for common Vietnamese spending (no AI call);
/// 3. Gemini (lite model) for new descriptions, cached and capped per user per day, separate from the chat limit.
/// </summary>
public sealed class TransactionCategorizationService(
    AppDbContext db,
    IAIOrchestrationService orchestration,
    IMemoryCache cache) : ITransactionCategorizationService
{
    /// <summary>AI suggestions per user per local day. The other methods are free and unlimited.</summary>
    public const int DailyAICap = 50;
    private const int HistoryRows = 400;
    private const decimal MinAIConfidence = 0.5m;
    private static readonly TimeSpan AICacheLifetime = TimeSpan.FromHours(12);

    private sealed record Option(Guid Id, string Name, string Folded);

    public async Task<CategorySuggestionResponse> SuggestAsync(Guid userId, SuggestCategoryRequest request,
        CancellationToken cancellationToken = default)
    {
        var description = request.Description.Trim();
        var folded = TextFold.Fold(description);
        var kind = request.Type == TransactionType.Income ? CategoryType.Income : CategoryType.Expense;
        if (folded.Length < 2) return None();

        // The user's own categories first, so they win over a system category with the same name.
        var options = (await db.Categories.AsNoTracking()
                .Where(c => c.IsActive && c.Type == kind && (c.IsSystem || c.UserId == userId))
                .OrderBy(c => c.IsSystem).ThenBy(c => c.Name)
                .Select(c => new { c.Id, c.Name })
                .ToListAsync(cancellationToken))
            .Select(c => new Option(c.Id, c.Name, TextFold.Fold(c.Name)))
            .ToList();
        if (options.Count == 0) return None();

        if (await FromHistoryAsync(userId, request.Type, folded, options, cancellationToken) is { } fromHistory)
            return fromHistory;
        if (FromRules(kind, folded, options) is { } fromRules) return fromRules;
        return await FromAIAsync(userId, request, description, folded, options, cancellationToken) ?? None();
    }

    public async Task ConfirmAsync(Guid userId, Guid logId, ConfirmCategorySuggestionRequest request,
        CancellationToken cancellationToken = default)
    {
        var log = await db.CategorySuggestionLogs.FirstOrDefaultAsync(l => l.Id == logId && l.UserId == userId,
            cancellationToken) ?? throw new NotFoundException("Không tìm thấy gợi ý danh mục.");
        var usable = await db.Categories.AnyAsync(c => c.Id == request.FinalCategoryId && c.IsActive
            && (c.IsSystem || c.UserId == userId), cancellationToken);
        if (!usable) throw new BadRequestException("Danh mục không hợp lệ.");
        log.FinalCategoryId = request.FinalCategoryId;
        await db.SaveChangesAsync(cancellationToken);
    }

    // ---- 1. history ----

    private async Task<CategorySuggestionResponse?> FromHistoryAsync(Guid userId, TransactionType type, string folded,
        IReadOnlyList<Option> options, CancellationToken cancellationToken)
    {
        var recent = await db.Transactions.AsNoTracking()
            .Where(t => t.UserId == userId && t.Type == type && t.Description != null && t.Description != "")
            .OrderByDescending(t => t.TransactionDate)
            .Take(HistoryRows)
            .Select(t => new { t.Description, t.CategoryId })
            .ToListAsync(cancellationToken);

        var byId = options.ToDictionary(o => o.Id);
        var rows = recent.Select(r => (Folded: TextFold.Fold(r.Description), r.CategoryId))
            .Where(r => r.Folded.Length > 0 && byId.ContainsKey(r.CategoryId))
            .ToList();

        // Same description: the category used most often for it (the most recent one wins a tie).
        var exact = rows.Where(r => r.Folded == folded).GroupBy(r => r.CategoryId)
            .OrderByDescending(g => g.Count()).FirstOrDefault();
        if (exact is not null)
            return Found(byId[exact.Key], 0.95m, "Giống giao dịch bạn đã ghi trước đây.", "History");

        // "grab về nhà" after "grab": one contains the other as whole words.
        if (folded.Length >= 3)
        {
            var padded = $" {folded} ";
            var partial = rows.FirstOrDefault(r => r.Folded.Length >= 3
                && (padded.Contains($" {r.Folded} ") || $" {r.Folded} ".Contains(padded)));
            if (partial.Folded is not null)
                return Found(byId[partial.CategoryId], 0.8m, "Giống giao dịch bạn đã ghi trước đây.", "History");
        }
        return null;
    }

    // ---- 2. keyword rules ----

    /// <summary>Folded keyword → default category name. Longer keywords are checked first ("grabfood" before "grab").</summary>
    private static readonly (string Keyword, string Category, CategoryType Type)[] Rules = BuildRules();

    private static (string, string, CategoryType)[] BuildRules()
    {
        var expense = new Dictionary<string, string[]>
        {
            ["Ăn uống"] = ["ca phe", "cafe", "coffee", "tra sua", "tra chanh", "an sang", "an trua", "an toi", "an vat",
                "do an", "com", "pho", "bun", "banh mi", "nha hang", "quan an", "highlands", "starbucks", "phuc long",
                "kfc", "lotteria", "jollibee", "pizza", "bia", "lau", "nuong", "grabfood", "shopeefood", "baemin", "di cho"],
            ["Di chuyển"] = ["grab", "grabbike", "grabcar", "xanh sm", "gojek", "taxi", "xang", "do xang", "gui xe", "ve xe", "xe buyt",
                "xe om", "metro", "sua xe", "rua xe", "thay nhot", "phi cau duong"],
            ["Nhà ở"] = ["tien nha", "thue nha", "tien phong", "tien tro", "nha tro"],
            ["Hóa đơn & tiện ích"] = ["tien dien", "tien nuoc", "internet", "wifi", "cuoc dien thoai", "nap tien dien thoai",
                "nap the", "hoa don", "truyen hinh", "phi chung cu", "phi quan ly"],
            ["Mua sắm"] = ["shopee", "lazada", "tiki", "tiktok shop", "quan ao", "giay", "my pham", "mua sam", "sieu thi",
                "winmart", "bach hoa xanh", "coopmart", "lotte mart", "aeon", "dien may"],
            ["Giải trí"] = ["phim", "cgv", "lotte cinema", "netflix", "spotify", "youtube premium", "game", "karaoke",
                "concert", "bida"],
            ["Sức khỏe"] = ["thuoc", "nha thuoc", "benh vien", "kham benh", "phong kham", "nha khoa", "gym", "bao hiem y te"],
            ["Giáo dục"] = ["hoc phi", "sach", "khoa hoc", "hoc them", "udemy", "coursera", "tieng anh"],
            ["Du lịch"] = ["khach san", "homestay", "ve may bay", "du lich", "agoda", "booking", "vietjet", "vietnam airlines",
                "bamboo airways", "resort"],
            ["Quà tặng & từ thiện"] = ["qua tang", "mua qua", "tu thien", "dam cuoi", "mung cuoi", "dam gio", "li xi", "phung vieng"],
        };
        var income = new Dictionary<string, string[]>
        {
            ["Lương"] = ["luong", "salary"],
            ["Thưởng"] = ["thuong", "bonus", "luong thang 13"],
            ["Đầu tư"] = ["co tuc", "lai tiet kiem", "lai ngan hang", "chung khoan", "co phieu", "crypto"],
            ["Kinh doanh"] = ["ban hang", "doanh thu", "kinh doanh", "freelance"],
            ["Được tặng"] = ["duoc cho", "duoc tang", "li xi", "mung tuoi"],
        };
        return expense.SelectMany(p => p.Value.Select(k => (k, p.Key, CategoryType.Expense)))
            .Concat(income.SelectMany(p => p.Value.Select(k => (k, p.Key, CategoryType.Income))))
            .OrderByDescending(r => r.Item1.Length)
            .ToArray();
    }

    private static CategorySuggestionResponse? FromRules(CategoryType kind, string folded, IReadOnlyList<Option> options)
    {
        var padded = $" {folded} ";
        foreach (var (keyword, category, type) in Rules)
        {
            if (type != kind || !padded.Contains($" {keyword} ")) continue;
            var target = TextFold.Fold(category);
            // The user may have hidden or renamed the default category; then the next keyword gets a chance.
            if (options.FirstOrDefault(o => o.Folded == target) is { } option)
                return Found(option, 0.85m, $"Từ khóa “{keyword}”.", "Rule");
        }
        return null;
    }

    // ---- 3. AI ----

    private async Task<CategorySuggestionResponse?> FromAIAsync(Guid userId, SuggestCategoryRequest request,
        string description, string folded, IReadOnlyList<Option> options, CancellationToken cancellationToken)
    {
        // Same text again (typing pauses, re-opening the form): reuse the answer, including "nothing fits".
        var cacheKey = $"ai-category:{userId:N}:{request.Type}:{folded}";
        if (cache.TryGetValue(cacheKey, out CategorySuggestionResponse? known)
            && (known?.CategoryId is null || options.Any(o => o.Id == known.CategoryId)))
            return known;

        var timeZoneId = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.TimeZoneId)
            .FirstOrDefaultAsync(cancellationToken) ?? "UTC";
        var (dayStart, _) = AIQuotaService.DayWindow(timeZoneId, DateTime.UtcNow);
        var usedToday = await db.AIProcessingLogs.CountAsync(l => l.UserId == userId && l.TaskType == AITasks.Categorize
            && l.Status == AIProcessingStatus.Completed && l.CreatedAt >= dayStart, cancellationToken);
        if (usedToday >= DailyAICap) return null;

        var result = await orchestration.CategorizeAsync(userId, description, request.Amount, request.Type,
            options.Select(o => new AICategoryOption(o.Id, o.Name)).ToList(), cancellationToken);
        if (result is null) return null; // AI failed: not cached, a later try may work

        var suggestion = result.CategoryId is not null && result.Confidence >= MinAIConfidence
            ? await LogAsync(userId, description, result, options, cancellationToken)
            : null;
        cache.Set(cacheKey, suggestion, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = AICacheLifetime, Size = 1 });
        return suggestion;
    }

    /// <summary>AI suggestions are logged, so the user's final choice can be recorded with <see cref="ConfirmAsync"/>.</summary>
    private async Task<CategorySuggestionResponse?> LogAsync(Guid userId, string description, AICategorizeResult result,
        IReadOnlyList<Option> options, CancellationToken cancellationToken)
    {
        var option = options.FirstOrDefault(o => o.Id == result.CategoryId);
        if (option is null) return null;
        var log = new CategorySuggestionLog
        {
            UserId = userId,
            Description = description.Length > 500 ? description[..500] : description,
            SuggestedCategoryId = option.Id,
            Confidence = Math.Round(result.Confidence, 2),
            Reason = result.Reason is { Length: > 300 } reason ? reason[..300] : result.Reason
        };
        db.CategorySuggestionLogs.Add(log);
        await db.SaveChangesAsync(cancellationToken);
        return new CategorySuggestionResponse(log.Id, option.Id, option.Name, log.Confidence, log.Reason, "AI");
    }

    private static CategorySuggestionResponse Found(Option option, decimal confidence, string reason, string method) =>
        new(null, option.Id, option.Name, confidence, reason, method);

    private static CategorySuggestionResponse None() => new(null, null, null, 0, null, "None");
}

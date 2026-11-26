using System.Globalization;

namespace backend.Helpers;

/// <summary>
/// A monthly budget period written as "yyyy-MM" (e.g. "2026-11"): the first to the last day of that month.
/// Used by the bulk budget API and by AI budget proposals, so both read the period the same way.
/// </summary>
public static class BudgetPeriod
{
    /// <summary>How far ahead a period may be planned.</summary>
    public const int MaxMonthsAhead = 12;

    public static bool TryParse(string? value, out DateOnly start, out DateOnly end)
    {
        start = end = default;
        if (string.IsNullOrWhiteSpace(value)
            || !DateOnly.TryParseExact(value.Trim() + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out start))
            return false;
        end = start.AddMonths(1).AddDays(-1);
        return true;
    }

    /// <summary>
    /// Parses and checks the period against the user's today: the current month or one of the next
    /// <see cref="MaxMonthsAhead"/> months (a past month cannot be budgeted any more).
    /// </summary>
    public static (DateOnly Start, DateOnly End) Require(string? value, DateOnly today)
    {
        if (!TryParse(value, out var start, out var end))
            throw new BadRequestException("Kỳ ngân sách phải có dạng yyyy-MM, ví dụ 2026-11.");
        var current = new DateOnly(today.Year, today.Month, 1);
        if (start < current) throw new BadRequestException("Không thể lập ngân sách cho tháng đã qua.");
        if (start > current.AddMonths(MaxMonthsAhead))
            throw new BadRequestException($"Chỉ lập ngân sách tối đa {MaxMonthsAhead} tháng tới.");
        return (start, end);
    }

    public static string Format(DateOnly day) => day.ToString("yyyy-MM", CultureInfo.InvariantCulture);
}

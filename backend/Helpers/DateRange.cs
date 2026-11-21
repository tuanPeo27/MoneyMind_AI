namespace backend.Helpers;

public static class DateRange
{
    /// <summary>Treats unspecified date-times as UTC (the API stores UTC).</summary>
    public static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };

    /// <summary>
    /// Exclusive upper bound for an inclusive "to" value. A date-only value (00:00:00) covers the whole day.
    /// </summary>
    public static DateTime EndExclusive(DateTime to) =>
        to.TimeOfDay == TimeSpan.Zero ? to.AddDays(1) : to.AddTicks(1);

    public static (DateTime Start, DateTime EndExclusive) Bounds(DateTime from, DateTime to)
    {
        var start = AsUtc(from);
        var end = EndExclusive(AsUtc(to));
        if (end <= start) throw new BadRequestException("Khoảng thời gian không hợp lệ: 'from' phải trước 'to'.");
        return (start, end);
    }

    public static DateTime StartOfDay(DateOnly date) => date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
}

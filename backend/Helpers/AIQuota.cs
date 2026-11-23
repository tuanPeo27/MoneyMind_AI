namespace backend.Helpers;

/// <summary>Task names written to <see cref="backend.Models.AIProcessingLog"/>. Daily message usage counts "Chat".</summary>
public static class AITasks
{
    public const string Chat = "Chat";
}

/// <summary>Rules for the number of AI chat messages a user may send per day.</summary>
public static class AIQuota
{
    /// <summary>Stored in <c>Users.AIDailyMessageLimit</c> and in the default setting to mean "no limit".</summary>
    public const int Unlimited = -1;

    /// <summary>Used when the default setting is missing or holds an invalid value.</summary>
    public const int FallbackDefault = 20;

    /// <summary>Admin-editable default, in <c>SystemSettings</c>.</summary>
    public const string DefaultSettingKey = "ai.default_daily_message_limit";

    /// <summary>The only values an admin can grant.</summary>
    public static readonly IReadOnlyList<int> AllowedLimits = [10, 20, 50, Unlimited];

    public static bool IsAllowed(int limit) => AllowedLimits.Contains(limit);

    public const string InvalidLimitMessage = "Hạn mức không hợp lệ. Chọn 10, 20, 50 hoặc không giới hạn.";
}

using backend.DTOs.Responses;
using backend.Services.Interfaces;

namespace backend.Helpers;

public static class AIQuotaMapping
{
    public static AIUsageResponse ToUsage(this AIQuotaStatus status) =>
        new(status.IsUnlimited, status.DailyLimit, status.Used, status.Remaining, status.ResetsAt);

    public static AdminAIQuotaResponse ToAdmin(this AIQuotaStatus status) =>
        new(status.CustomLimit, status.DailyLimit, status.IsUnlimited, status.Used);
}

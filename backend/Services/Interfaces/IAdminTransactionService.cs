using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

/// <summary>Aggregated, non-identifying transaction statistics for the administration area.</summary>
public interface IAdminTransactionService
{
    /// <param name="from">Inclusive start (UTC). Defaults to 29 days before <paramref name="to"/>.</param>
    /// <param name="to">Inclusive end (UTC); a date-only value covers the whole day. Defaults to today.</param>
    Task<AdminTransactionStatsResponse> GetStatsAsync(DateTime? from, DateTime? to,
        CancellationToken cancellationToken = default);
}
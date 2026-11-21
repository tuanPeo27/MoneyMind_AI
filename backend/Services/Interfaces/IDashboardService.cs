using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Models;

namespace backend.Services.Interfaces;

public interface IDashboardService
{
    /// <summary>Overview for the given range (defaults to the current month).</summary>
    Task<DashboardOverviewResponse> GetOverviewAsync(Guid userId, DateTime? from = null, DateTime? to = null,
        CancellationToken cancellationToken = default);

    Task<ReportResponse> GetReportAsync(Guid userId, DateTime from, DateTime to,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TrendPoint>> GetTrendAsync(Guid userId, DateTime from, DateTime to, bool groupByMonth = false,
        CancellationToken cancellationToken = default);

    Task<ReportSnapshotResponse> CreateSnapshotAsync(Guid userId, ReportPeriodType periodType,
        DateOnly? referenceDate = null, CancellationToken cancellationToken = default);

    Task<PagedResult<ReportSnapshotResponse>> GetSnapshotsAsync(Guid userId, ReportPeriodType? periodType,
        PagingQuery paging, CancellationToken cancellationToken = default);
}

using System.ComponentModel.DataAnnotations;
using backend.Models;

namespace backend.DTOs.Requests;

public sealed class AdminUserQuery : PagingQuery
{
    public string? Search { get; set; }
    public bool? IsActive { get; set; }
}

public sealed record LockUserRequest([Required, StringLength(500)] string Reason);

public sealed record UpsertAnnouncementRequest(
    [Required, StringLength(200)] string Title,
    [Required, StringLength(4000)] string Content,
    DateTime StartAt,
    DateTime? EndAt,
    bool IsActive = true);

public sealed record UpsertSettingRequest(
    [Required] string Value,
    [StringLength(500)] string? Description);

public sealed class AuditLogQuery : PagingQuery
{
    public Guid? AdminId { get; set; }
    public string? Action { get; set; }
    public string? TargetType { get; set; }
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
}

public sealed class AIProcessingLogQuery : PagingQuery
{
    public string? TaskType { get; set; }
    public AIProcessingStatus? Status { get; set; }
    public Guid? UserId { get; set; }
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
}

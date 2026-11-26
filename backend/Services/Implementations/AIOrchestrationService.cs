using System.Diagnostics;
using backend.DTOs;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;

namespace backend.Services.Implementations;

public sealed class AIOrchestrationService(
    IAIServiceClient client,
    IFinancialAnalysisService analysis,
    IAIProcessingLogService logs,
    ILogger<AIOrchestrationService> logger) : IAIOrchestrationService
{
    public async Task<AIChatResult> ChatAsync(Guid userId, string message, IReadOnlyList<AIChatTurn> history,
        string? language = null, Func<string, Task>? onDelta = null, string mode = AIChatModes.Chat,
        CancellationToken cancellationToken = default)
    {
        var requestId = Guid.NewGuid();
        var watch = Stopwatch.StartNew();
        try
        {
            var context = mode == AIChatModes.Capture
                ? await analysis.BuildCaptureContextAsync(userId, cancellationToken)
                : await analysis.BuildContextAsync(userId, cancellationToken);
            // Quick entry is logged as Chat on purpose: it counts against the same daily message limit.
            var result = await client.StreamChatAsync(new AIChatPayload(message, history, context, language, mode), onDelta,
                cancellationToken);
            await LogSafelyAsync(userId, requestId, AITasks.Chat, DescribeProvider(result), watch, AIProcessingStatus.Completed,
                null, result.TokenUsage, cancellationToken);
            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            await LogSafelyAsync(userId, requestId, AITasks.Chat, "gemini", watch, AIProcessingStatus.Failed,
                ex.GetType().Name, null, cancellationToken);
            logger.LogError(ex, "AI chat request {RequestId} failed for user {UserId}", requestId, userId);
            if (ex is ServiceUnavailableException) throw;
            throw new ServiceUnavailableException("Dịch vụ AI tạm thời không khả dụng.");
        }
    }

    public async Task<AICategorizeResult?> CategorizeAsync(Guid userId, string description, decimal? amount,
        TransactionType type, IReadOnlyList<AICategoryOption> categories,
        CancellationToken cancellationToken = default)
    {
        var requestId = Guid.NewGuid();
        var watch = Stopwatch.StartNew();
        var choices = categories.Select((c, i) => new AICategoryChoice((i + 1).ToString(), c.Name)).ToList();
        try
        {
            var reply = await client.CategorizeAsync(
                new AICategorizePayload(description, amount, type.ToString(), choices), cancellationToken);
            await LogSafelyAsync(userId, requestId, AITasks.Categorize,
                reply.Model is null ? reply.Provider : $"{reply.Provider}/{reply.Model}", watch,
                AIProcessingStatus.Completed, null, reply.TokenUsage, cancellationToken);
            var index = int.TryParse(reply.CategoryId, out var n) && n >= 1 && n <= categories.Count ? n - 1 : -1;
            return new AICategorizeResult(index >= 0 ? categories[index].Id : null, index >= 0 ? reply.Confidence : 0,
                reply.Reason, reply.TokenUsage, reply.Provider);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            await LogSafelyAsync(userId, requestId, AITasks.Categorize, "gemini", watch, AIProcessingStatus.Failed,
                ex.GetType().Name, null, cancellationToken);
            logger.LogWarning(ex, "AI categorization {RequestId} failed for user {UserId}", requestId, userId);
            return null;
        }
    }

    public async Task<AIInsightResult?> GenerateInsightsAsync(Guid userId, string facts,
        CancellationToken cancellationToken = default)
    {
        var requestId = Guid.NewGuid();
        var watch = Stopwatch.StartNew();
        try
        {
            var result = await client.GenerateInsightsAsync(new AIInsightPayload(facts), cancellationToken);
            await LogSafelyAsync(userId, requestId, AITasks.WeeklyInsight,
                result.Model is null ? result.Provider : $"{result.Provider}/{result.Model}", watch,
                AIProcessingStatus.Completed, null, result.TokenUsage, cancellationToken);
            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            await LogSafelyAsync(userId, requestId, AITasks.WeeklyInsight, "gemini", watch, AIProcessingStatus.Failed,
                ex.GetType().Name, null, cancellationToken);
            logger.LogWarning(ex, "Weekly insight {RequestId} failed for user {UserId}", requestId, userId);
            return null;
        }
    }

    /// <summary>"gemini/gemini-3.5-flash-lite": shows in the admin log which model answered, including fallbacks.</summary>
    private static string? DescribeProvider(AIChatResult result) =>
        result.Model is null ? result.Provider : $"{result.Provider}/{result.Model}";

    private async Task LogSafelyAsync(Guid userId, Guid requestId, string taskType, string? provider,
        Stopwatch watch, AIProcessingStatus status, string? errorCode, int? tokens, CancellationToken ct)
    {
        try
        {
            await logs.LogAsync(userId, requestId, taskType, provider, (int)watch.ElapsedMilliseconds, status,
                errorCode, tokens, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not store AI processing log {RequestId}", requestId);
        }
    }
}

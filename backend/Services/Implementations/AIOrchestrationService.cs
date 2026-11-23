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
        string? language = null, CancellationToken cancellationToken = default)
    {
        var requestId = Guid.NewGuid();
        var watch = Stopwatch.StartNew();
        try
        {
            var context = await analysis.BuildContextAsync(userId, cancellationToken);
            var result = await client.ChatAsync(new AIChatPayload(message, history, context, language), cancellationToken);
            await LogSafelyAsync(userId, requestId, "Chat", result.Provider, watch, AIProcessingStatus.Completed,
                null, result.TokenUsage, cancellationToken);
            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            await LogSafelyAsync(userId, requestId, "Chat", "gemini", watch, AIProcessingStatus.Failed,
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
        var context = new AICategorizePayload(description, amount, type.ToString(), categories);
        return await client.CategorizeAsync(context, cancellationToken);
    }

    public async Task<AIInsightResult?> GenerateInsightsAsync(Guid userId,
        CancellationToken cancellationToken = default)
    {
        var context = await analysis.BuildContextAsync(userId, cancellationToken);
        return await client.GenerateInsightsAsync(new AIInsightPayload(context), cancellationToken);
    }

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

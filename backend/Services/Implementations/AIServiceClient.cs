using System.Net.Http.Json;
using backend.DTOs;
using backend.Helpers;
using backend.Services.Interfaces;

namespace backend.Services.Implementations;

/// <summary>HTTP client for the private Python AI service. The Gemini API key never enters this process.</summary>
public sealed class AIServiceClient(HttpClient http, ILogger<AIServiceClient> logger) : IAIServiceClient
{
    public Task<AIChatResult> ChatAsync(AIChatPayload payload, CancellationToken cancellationToken = default) =>
        PostAsync<AIChatPayload, AIChatResult>("v1/chat", payload, cancellationToken);

    public Task<AICategorizeResult> CategorizeAsync(AICategorizePayload payload,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("AI categorization has not been implemented by the AI service yet.");

    public Task<AIInsightResult> GenerateInsightsAsync(AIInsightPayload payload,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("AI insight generation has not been implemented by the AI service yet.");

    public async Task<bool> IsHealthyAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await http.GetAsync("health", cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(ex, "AI service health request failed.");
            return false;
        }
    }

    private async Task<TResponse> PostAsync<TRequest, TResponse>(string path, TRequest payload,
        CancellationToken cancellationToken)
    {
        using var response = await http.PostAsJsonAsync(path, payload, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("AI service returned {StatusCode} for {Path}", (int)response.StatusCode, path);
            throw new ServiceUnavailableException("Dịch vụ AI tạm thời không khả dụng.");
        }

        return await response.Content.ReadFromJsonAsync<TResponse>(cancellationToken)
            ?? throw new ServiceUnavailableException("Dịch vụ AI trả về dữ liệu không hợp lệ.");
    }
}

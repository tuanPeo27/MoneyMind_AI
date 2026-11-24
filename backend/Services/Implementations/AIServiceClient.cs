using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using backend.DTOs;
using backend.Helpers;
using backend.Services.Interfaces;

namespace backend.Services.Implementations;

/// <summary>HTTP client for the private Python AI service. The Gemini API key never enters this process.</summary>
public sealed class AIServiceClient(HttpClient http, ILogger<AIServiceClient> logger) : IAIServiceClient
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public Task<AIChatResult> ChatAsync(AIChatPayload payload, CancellationToken cancellationToken = default) =>
        StreamChatAsync(payload, null, cancellationToken);

    public async Task<AIChatResult> StreamChatAsync(AIChatPayload payload, Func<string, Task>? onDelta,
        CancellationToken cancellationToken = default)
    {
        // HttpClient.Timeout stops at the response headers; the whole streamed answer gets the same limit here.
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(http.Timeout);

        using var request = new HttpRequestMessage(HttpMethod.Post, "v1/chat/stream") { Content = JsonContent.Create(payload, options: Json) };
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("AI service returned {StatusCode} for v1/chat/stream", (int)response.StatusCode);
            throw new ServiceUnavailableException("Dịch vụ AI tạm thời không khả dụng.");
        }

        await using var body = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var reader = new StreamReader(body, Encoding.UTF8);
        var text = new StringBuilder();
        var actions = new List<AIProposedAction>();
        AIStreamEvent? done = null;

        while (await reader.ReadLineAsync(timeout.Token) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var evt = JsonSerializer.Deserialize<AIStreamEvent>(line, Json)
                ?? throw new ServiceUnavailableException("Dịch vụ AI trả về dữ liệu không hợp lệ.");
            switch (evt.Type)
            {
                case "delta" when !string.IsNullOrEmpty(evt.Text):
                    text.Append(evt.Text);
                    if (onDelta is not null) await onDelta(evt.Text);
                    break;
                case "action" when evt.Name is not null:
                    actions.Add(new AIProposedAction(evt.Name, evt.Args?.Clone() ?? default));
                    break;
                case "done":
                    done = evt;
                    break;
                case "error":
                    logger.LogWarning("AI service stopped while answering: {Message}", evt.Message);
                    throw new ServiceUnavailableException("Dịch vụ AI tạm thời không khả dụng.");
            }
        }

        if (done is null) throw new ServiceUnavailableException("Dịch vụ AI dừng trước khi trả lời xong.");
        return new AIChatResult(text.ToString().Trim(), done.Intent, done.TokenUsage, done.Provider, done.Model, actions);
    }

    public Task<AICategorizeReply> CategorizeAsync(AICategorizePayload payload,
        CancellationToken cancellationToken = default) =>
        PostAsync<AICategorizeReply>("v1/categorize", payload, cancellationToken);

    private async Task<T> PostAsync<T>(string path, object payload, CancellationToken cancellationToken)
    {
        using var response = await http.PostAsJsonAsync(path, payload, Json, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("AI service returned {StatusCode} for {Path}", (int)response.StatusCode, path);
            throw new ServiceUnavailableException("Dịch vụ AI tạm thời không khả dụng.");
        }
        return await response.Content.ReadFromJsonAsync<T>(Json, cancellationToken)
            ?? throw new ServiceUnavailableException("Dịch vụ AI trả về dữ liệu không hợp lệ.");
    }

    public Task<AIInsightResult> GenerateInsightsAsync(AIInsightPayload payload,
        CancellationToken cancellationToken = default) =>
        PostAsync<AIInsightResult>("v1/insights", payload, cancellationToken);

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
}

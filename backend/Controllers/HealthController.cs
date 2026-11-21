using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

/// <summary>Public liveness probe for load balancers and the web client. Exposes no internal details.</summary>
[ApiController]
[AllowAnonymous]
[Route("api/health")]
public sealed class HealthController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        bool databaseUp;
        try
        {
            databaseUp = await db.Database.CanConnectAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            databaseUp = false;
        }

        var body = new { status = databaseUp ? "Healthy" : "Unhealthy", checkedAt = DateTime.UtcNow };
        return databaseUp ? Ok(body) : StatusCode(StatusCodes.Status503ServiceUnavailable, body);
    }
}

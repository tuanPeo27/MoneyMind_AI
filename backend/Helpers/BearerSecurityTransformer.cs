using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace backend.Helpers;

/// <summary>Adds the JWT Bearer scheme to the OpenAPI document so Swagger UI shows an Authorize button.</summary>
public sealed class BearerSecurityTransformer : IOpenApiDocumentTransformer
{
    public Task TransformAsync(OpenApiDocument document, OpenApiDocumentTransformerContext context,
        CancellationToken cancellationToken)
    {
        document.Info = new OpenApiInfo { Title = "MoneyMind AI API", Version = "v1" };

        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
        document.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT",
            Description = "Nhập access token (không cần tiền tố 'Bearer ')."
        };

        // Applied to every operation; endpoints marked [AllowAnonymous] simply ignore the header.
        document.Security =
        [
            new OpenApiSecurityRequirement
            {
                [new OpenApiSecuritySchemeReference("Bearer", document)] = []
            }
        ];

        return Task.CompletedTask;
    }
}

namespace backend.Helpers;

public abstract class AppException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public sealed class BadRequestException(string message) : AppException(message, StatusCodes.Status400BadRequest);

public sealed class UnauthorizedAppException(string message = "Unauthorized.")
    : AppException(message, StatusCodes.Status401Unauthorized);

public sealed class ForbiddenException(string message = "Forbidden.")
    : AppException(message, StatusCodes.Status403Forbidden);

public sealed class NotFoundException(string message = "Resource not found.")
    : AppException(message, StatusCodes.Status404NotFound);

public sealed class ConflictException(string message) : AppException(message, StatusCodes.Status409Conflict);

public sealed class TooManyRequestsException(string message)
    : AppException(message, StatusCodes.Status429TooManyRequests);

public sealed class ServiceUnavailableException(string message)
    : AppException(message, StatusCodes.Status503ServiceUnavailable);

namespace backend.Services.Interfaces;

public interface IEmailService
{
    Task SendAsync(string to, string subject, string htmlBody, CancellationToken cancellationToken = default);

    Task SendPasswordResetAsync(string to, string fullName, string resetToken,
        CancellationToken cancellationToken = default);
}

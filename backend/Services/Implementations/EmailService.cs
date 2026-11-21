using System.Net;
using System.Net.Mail;
using System.Text.Encodings.Web;
using backend.Options;
using backend.Services.Interfaces;
using Microsoft.Extensions.Options;

namespace backend.Services.Implementations;

public sealed class EmailService(
    IOptions<SmtpOptions> smtpOptions,
    IOptions<AppOptions> appOptions,
    IHostEnvironment environment,
    ILogger<EmailService> logger) : IEmailService
{
    private readonly SmtpOptions _smtp = smtpOptions.Value;
    private readonly AppOptions _app = appOptions.Value;

    public async Task SendAsync(string to, string subject, string htmlBody,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_smtp.Host))
        {
            // No SMTP configured: only the development environment may print the content.
            if (environment.IsDevelopment())
                logger.LogWarning("SMTP not configured. Email to {To}, subject '{Subject}':\n{Body}", to, subject, htmlBody);
            else
                logger.LogError("SMTP not configured. Email to {To} was not sent.", to);
            return;
        }

        using var message = new MailMessage
        {
            From = new MailAddress(_smtp.FromAddress, _smtp.FromName),
            Subject = subject,
            Body = htmlBody,
            IsBodyHtml = true
        };
        message.To.Add(to);

        using var client = new SmtpClient(_smtp.Host, _smtp.Port) { EnableSsl = _smtp.EnableSsl };
        if (!string.IsNullOrEmpty(_smtp.Username))
            client.Credentials = new NetworkCredential(_smtp.Username, _smtp.Password);

        await client.SendMailAsync(message, cancellationToken);
    }

    public Task SendPasswordResetAsync(string to, string fullName, string resetToken,
        CancellationToken cancellationToken = default)
    {
        var link = $"{_app.FrontendUrl.TrimEnd('/')}/reset-password?token={Uri.EscapeDataString(resetToken)}";
        if (string.IsNullOrWhiteSpace(_smtp.Host) && environment.IsDevelopment())
            logger.LogWarning("Password reset link for {To} (token is the part after 'token='): {Link}", to, link);

        var encoder = HtmlEncoder.Default;
        var body = $"""
            <p>Xin chào {encoder.Encode(fullName)},</p>
            <p>Bạn vừa yêu cầu đặt lại mật khẩu MoneyMind AI. Nhấn vào liên kết bên dưới
            (có hiệu lực {_app.PasswordResetMinutes} phút):</p>
            <p><a href="{encoder.Encode(link)}">Đặt lại mật khẩu</a></p>
            <p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
            """;
        return SendAsync(to, "Đặt lại mật khẩu MoneyMind AI", body, cancellationToken);
    }
}

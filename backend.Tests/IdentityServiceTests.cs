using System.IdentityModel.Tokens.Jwt;
using System.Text;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Options;
using backend.Services.Implementations;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace backend.Tests;

/// <summary>Real ASP.NET Identity (UserManager/RoleManager) on top of the SQLite test database.</summary>
public abstract class IdentityTestBase : DbTestBase
{
    protected const string ValidPassword = "Password1";
    private readonly ServiceCollection _registrations;
    protected UserManager<ApplicationUser> Users { get; }
    protected RoleManager<IdentityRole<Guid>> RoleMgr { get; }

    /// <summary>A provider with the same Identity/database registrations plus whatever the test adds.</summary>
    protected IServiceProvider BuildProvider(Action<IServiceCollection>? extra = null)
    {
        var copy = new ServiceCollection();
        foreach (var descriptor in _registrations) ((ICollection<ServiceDescriptor>)copy).Add(descriptor);
        extra?.Invoke(copy);
        return copy.BuildServiceProvider();
    }

    protected IdentityTestBase()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<Microsoft.AspNetCore.DataProtection.IDataProtectionProvider>(
            new Microsoft.AspNetCore.DataProtection.EphemeralDataProtectionProvider());
        services.AddSingleton(Db);
        services.AddIdentityCore<ApplicationUser>(options =>
            {
                options.User.RequireUniqueEmail = true;
                options.Password.RequiredLength = 8;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = false;
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                options.Lockout.AllowedForNewUsers = true;
            })
            .AddRoles<IdentityRole<Guid>>()
            .AddEntityFrameworkStores<backend.Data.AppDbContext>()
            .AddDefaultTokenProviders();
        _registrations = services;
        var provider = services.BuildServiceProvider();
        Users = provider.GetRequiredService<UserManager<ApplicationUser>>();
        RoleMgr = provider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        foreach (var role in new[] { Roles.User, Roles.Admin })
            RoleMgr.CreateAsync(new IdentityRole<Guid>(role)).GetAwaiter().GetResult();
    }

    protected async Task<ApplicationUser> CreateUserAsync(string email, string? password = ValidPassword,
        string? role = null, bool active = true)
    {
        var user = new ApplicationUser { Email = email, UserName = email, FullName = "Name " + email, IsActive = active };
        var result = password is null ? await Users.CreateAsync(user) : await Users.CreateAsync(user, password);
        Assert.True(result.Succeeded, result.Describe());
        if (role is not null) await Users.AddToRoleAsync(user, role);
        return user;
    }
}

public sealed class FakeEmail : IEmailService
{
    public bool Fail { get; set; }
    public List<(string To, string FullName, string Token)> ResetEmails { get; } = [];

    public Task SendAsync(string to, string subject, string htmlBody, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task SendPasswordResetAsync(string to, string fullName, string resetToken,
        CancellationToken cancellationToken = default)
    {
        if (Fail) throw new InvalidOperationException("smtp down");
        ResetEmails.Add((to, fullName, resetToken));
        return Task.CompletedTask;
    }
}

public class TokenServiceTests
{
    private const string Key = "0123456789abcdef0123456789abcdef-secret";

    private static TokenService Create(int accessMinutes = 15, int refreshDays = 14) =>
        new(Microsoft.Extensions.Options.Options.Create(new JwtOptions
        {
            Issuer = "issuer", Audience = "audience", Key = Key, AccessTokenMinutes = accessMinutes,
            RefreshTokenDays = refreshDays
        }));

    private static ApplicationUser User() =>
        new() { Email = "a@b.com", UserName = "a@b.com", FullName = "An Nguyen" };

    [Fact]
    public void AccessToken_ContainsIdentityClaims()
    {
        var user = User();
        var (token, _) = Create().CreateAccessToken(user, ["User"]);
        var jwt = new JsonWebTokenHandler().ReadJsonWebToken(token);
        Assert.Equal(user.Id.ToString(), jwt.Subject);
        Assert.Equal("a@b.com", jwt.GetClaim("email").Value);
        Assert.Equal("An Nguyen", jwt.GetClaim("name").Value);
        Assert.Equal("issuer", jwt.Issuer);
        Assert.Contains("audience", jwt.Audiences);
    }

    [Fact]
    public void AccessToken_ContainsEveryRole()
    {
        var (token, _) = Create().CreateAccessToken(User(), ["User", "Admin"]);
        var roles = new JsonWebTokenHandler().ReadJsonWebToken(token).Claims.Where(c => c.Type == "role").Select(c => c.Value);
        Assert.Equivalent(new[] { "User", "Admin" }, roles);
    }

    [Fact]
    public void AccessToken_WithoutRoles_HasNoRoleClaim()
    {
        var (token, _) = Create().CreateAccessToken(User(), []);
        Assert.DoesNotContain(new JsonWebTokenHandler().ReadJsonWebToken(token).Claims, c => c.Type == "role");
    }

    [Theory]
    [InlineData(1)]
    [InlineData(15)]
    [InlineData(60)]
    public void AccessToken_ExpiresAfterConfiguredMinutes(int minutes)
    {
        var (_, expires) = Create(minutes).CreateAccessToken(User(), []);
        var expected = DateTime.UtcNow.AddMinutes(minutes);
        Assert.InRange((expires - expected).TotalSeconds, -5, 5);
    }

    [Fact]
    public async Task AccessToken_IsSignedWithTheConfiguredKey()
    {
        var (token, _) = Create().CreateAccessToken(User(), []);
        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidIssuer = "issuer", ValidAudience = "audience",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Key))
        });
        Assert.True(result.IsValid);
    }

    [Fact]
    public async Task AccessToken_IsRejectedWithAnotherKey()
    {
        var (token, _) = Create().CreateAccessToken(User(), []);
        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidIssuer = "issuer", ValidAudience = "audience",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes("another-key-another-key-another-key-1234"))
        });
        Assert.False(result.IsValid);
    }

    [Fact]
    public async Task AccessToken_IsRejectedForAnotherAudience()
    {
        var (token, _) = Create().CreateAccessToken(User(), []);
        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidIssuer = "issuer", ValidAudience = "someone-else",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Key))
        });
        Assert.False(result.IsValid);
    }

    [Fact]
    public void AccessToken_EachTokenHasAUniqueId()
    {
        var service = Create();
        var handler = new JsonWebTokenHandler();
        var a = handler.ReadJsonWebToken(service.CreateAccessToken(User(), []).Token).Id;
        var b = handler.ReadJsonWebToken(service.CreateAccessToken(User(), []).Token).Id;
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void AccessToken_UserWithoutEmail_GetsEmptyEmailClaim()
    {
        var user = new ApplicationUser { FullName = "x" };
        var (token, _) = Create().CreateAccessToken(user, []);
        Assert.Equal(string.Empty, new JsonWebTokenHandler().ReadJsonWebToken(token).GetClaim("email").Value);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(14)]
    [InlineData(365)]
    public void RefreshTokenLifetime_FollowsConfiguration(int days) =>
        Assert.Equal(TimeSpan.FromDays(days), Create(refreshDays: days).RefreshTokenLifetime);

    [Fact]
    public void GenerateRefreshToken_IsUniqueAndUrlSafe()
    {
        var service = Create();
        var tokens = Enumerable.Range(0, 50).Select(_ => service.GenerateRefreshToken()).ToList();
        Assert.Equal(50, tokens.Distinct().Count());
        Assert.All(tokens, t => Assert.Matches("^[A-Za-z0-9_-]+$", t));
    }

    [Fact]
    public void HashToken_MatchesSha256AndIsDeterministic()
    {
        var service = Create();
        Assert.Equal(SecurityHelper.Sha256("abc"), service.HashToken("abc"));
        Assert.Equal(service.HashToken("abc"), service.HashToken("abc"));
        Assert.NotEqual(service.HashToken("abc"), service.HashToken("abd"));
    }
}

public class AuthServiceTests : IdentityTestBase
{
    private readonly FakeEmail _email = new();
    private readonly FakeCurrentUser _current = new();
    private readonly TokenService _tokens = new(Microsoft.Extensions.Options.Options.Create(new JwtOptions
    {
        Issuer = "i", Audience = "a", Key = "0123456789abcdef0123456789abcdef-secret", AccessTokenMinutes = 15,
        RefreshTokenDays = 14
    }));
    private readonly AuthService _sut;

    public AuthServiceTests() => _sut = Create();

    private AuthService Create(string googleClientId = "") =>
        new(Users, RoleMgr, Db, _tokens, _email, _current,
            Microsoft.Extensions.Options.Options.Create(new AppOptions { PasswordResetMinutes = 60 }),
            Microsoft.Extensions.Options.Options.Create(new GoogleOptions { ClientId = googleClientId }),
            NullLogger<AuthService>.Instance);

    private Task<AuthResponse> Register(string email = "an@x.com", string password = ValidPassword, string name = "An") =>
        _sut.RegisterAsync(new RegisterRequest(name, email, password));

    // ---- Register ----

    [Fact]
    public async Task Register_ReturnsTokensAndUserRole()
    {
        var result = await Register();
        Assert.False(string.IsNullOrEmpty(result.AccessToken));
        Assert.False(string.IsNullOrEmpty(result.RefreshToken));
        Assert.Equal(["User"], result.User.Roles);
        Assert.True(result.User.HasPassword);
    }

    [Fact]
    public async Task Register_NormalizesEmailToLowerCaseAndTrimsName()
    {
        var result = await Register("  An@X.COM ", name: "  An Nguyen  ");
        Assert.Equal("an@x.com", result.User.Email);
        Assert.Equal("An Nguyen", result.User.FullName);
    }

    [Fact]
    public async Task Register_DuplicateEmail_ThrowsConflict()
    {
        await Register("an@x.com");
        await Assert.ThrowsAsync<ConflictException>(() => Register("AN@x.com"));
    }

    [Theory]
    [InlineData("password1")]
    [InlineData("PASSWORD1")]
    [InlineData("Password")]
    [InlineData("Pass1")]
    public async Task Register_WeakPassword_ThrowsBadRequestAndCreatesNoUser(string password)
    {
        var before = Db.Users.Count();
        await Assert.ThrowsAsync<BadRequestException>(() => Register(password: password));
        Assert.Equal(before, Db.Users.Count());
    }

    [Fact]
    public async Task Register_StoresOnlyTheHashOfTheRefreshToken()
    {
        var result = await Register();
        var stored = Assert.Single(Db.RefreshTokens);
        Assert.NotEqual(result.RefreshToken, stored.TokenHash);
        Assert.Equal(_tokens.HashToken(result.RefreshToken), stored.TokenHash);
    }

    [Fact]
    public async Task Register_RecordsDeviceAndIpOnSession()
    {
        await Register();
        var stored = Assert.Single(Db.RefreshTokens);
        Assert.Equal("127.0.0.1", stored.IpAddress);
        Assert.Equal("tests", stored.DeviceInfo);
    }

    [Fact]
    public async Task Register_SetsLastLogin()
    {
        var result = await Register();
        Assert.NotNull(result.User.LastLoginAt);
    }

    // ---- Login ----

    [Fact]
    public async Task Login_WithCorrectPassword_ReturnsTokens()
    {
        await Register("an@x.com");
        var result = await _sut.LoginAsync(new LoginRequest("an@x.com", ValidPassword));
        Assert.Equal("an@x.com", result.User.Email);
        Assert.Equal(2, Db.RefreshTokens.Count());
    }

    [Fact]
    public async Task Login_EmailIsCaseInsensitive()
    {
        await Register("an@x.com");
        var result = await _sut.LoginAsync(new LoginRequest("  AN@X.com ", ValidPassword));
        Assert.Equal("an@x.com", result.User.Email);
    }

    [Fact]
    public async Task Login_UnknownEmail_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.LoginAsync(new LoginRequest("no@x.com", ValidPassword)));

    [Fact]
    public async Task Login_WrongPassword_ThrowsUnauthorized()
    {
        await Register("an@x.com");
        await Assert.ThrowsAsync<UnauthorizedAppException>(() =>
            _sut.LoginAsync(new LoginRequest("an@x.com", "Wrong-pass1")));
    }

    [Fact]
    public async Task Login_WrongPassword_CountsAFailedAttempt()
    {
        await Register("an@x.com");
        await Assert.ThrowsAsync<UnauthorizedAppException>(() =>
            _sut.LoginAsync(new LoginRequest("an@x.com", "Wrong-pass1")));
        Assert.Equal(1, (await Users.FindByEmailAsync("an@x.com"))!.AccessFailedCount);
    }

    [Fact]
    public async Task Login_AfterFiveFailures_AccountIsLockedEvenWithCorrectPassword()
    {
        await Register("an@x.com");
        for (var i = 0; i < 5; i++)
            await Assert.ThrowsAsync<UnauthorizedAppException>(() =>
                _sut.LoginAsync(new LoginRequest("an@x.com", "Wrong-pass1")));
        await Assert.ThrowsAsync<ForbiddenException>(() =>
            _sut.LoginAsync(new LoginRequest("an@x.com", ValidPassword)));
    }

    [Fact]
    public async Task Login_SuccessResetsFailedCounter()
    {
        await Register("an@x.com");
        await Assert.ThrowsAsync<UnauthorizedAppException>(() =>
            _sut.LoginAsync(new LoginRequest("an@x.com", "Wrong-pass1")));
        await _sut.LoginAsync(new LoginRequest("an@x.com", ValidPassword));
        Assert.Equal(0, (await Users.FindByEmailAsync("an@x.com"))!.AccessFailedCount);
    }

    [Fact]
    public async Task Login_DeactivatedAccount_ThrowsForbidden()
    {
        await CreateUserAsync("locked@x.com", active: false);
        await Assert.ThrowsAsync<ForbiddenException>(() =>
            _sut.LoginAsync(new LoginRequest("locked@x.com", ValidPassword)));
    }

    [Fact]
    public async Task Login_AccountWithoutPassword_ThrowsUnauthorizedMentioningGoogle()
    {
        await CreateUserAsync("g@x.com", password: null);
        var ex = await Assert.ThrowsAsync<UnauthorizedAppException>(() =>
            _sut.LoginAsync(new LoginRequest("g@x.com", ValidPassword)));
        Assert.Contains("Google", ex.Message);
    }

    [Fact]
    public async Task Login_UpdatesLastLogin()
    {
        await Register("an@x.com");
        var before = DateTime.UtcNow;
        var result = await _sut.LoginAsync(new LoginRequest("an@x.com", ValidPassword));
        Assert.True(result.User.LastLoginAt >= before.AddSeconds(-1));
    }

    // ---- Google ----

    [Fact]
    public async Task GoogleLogin_NotConfigured_ThrowsServiceUnavailable() =>
        await Assert.ThrowsAsync<ServiceUnavailableException>(() =>
            _sut.GoogleLoginAsync(new GoogleLoginRequest("token")));

    [Fact]
    public async Task GoogleLogin_MalformedToken_ThrowsUnauthorized()
    {
        var sut = Create("client-id");
        await Assert.ThrowsAsync<UnauthorizedAppException>(() =>
            sut.GoogleLoginAsync(new GoogleLoginRequest("not-a-jwt")));
    }

    // ---- Refresh ----

    [Fact]
    public async Task Refresh_RotatesTheToken()
    {
        var first = await Register();
        var second = await _sut.RefreshAsync(new RefreshTokenRequest(first.RefreshToken));
        Assert.NotEqual(first.RefreshToken, second.RefreshToken);
        var oldHash = _tokens.HashToken(first.RefreshToken);
        Assert.NotNull(Db.RefreshTokens.Single(t => t.TokenHash == oldHash).RevokedAt);
    }

    [Fact]
    public async Task Refresh_NewTokenKeepsWorking()
    {
        var first = await Register();
        var second = await _sut.RefreshAsync(new RefreshTokenRequest(first.RefreshToken));
        var third = await _sut.RefreshAsync(new RefreshTokenRequest(second.RefreshToken));
        Assert.False(string.IsNullOrEmpty(third.AccessToken));
    }

    [Fact]
    public async Task Refresh_UnknownToken_ThrowsUnauthorized() =>
        await Assert.ThrowsAsync<UnauthorizedAppException>(() => _sut.RefreshAsync(new RefreshTokenRequest("nope")));

    [Fact]
    public async Task Refresh_ReusingARevokedToken_RevokesEveryRefreshTokenOfTheUser()
    {
        var first = await Register();
        var second = await _sut.RefreshAsync(new RefreshTokenRequest(first.RefreshToken));
        await Assert.ThrowsAsync<UnauthorizedAppException>(() => _sut.RefreshAsync(new RefreshTokenRequest(first.RefreshToken)));
        Db.ChangeTracker.Clear();
        Assert.All(Db.RefreshTokens, t => Assert.NotNull(t.RevokedAt));
        await Assert.ThrowsAsync<UnauthorizedAppException>(() => _sut.RefreshAsync(new RefreshTokenRequest(second.RefreshToken)));
    }

    [Fact]
    public async Task Refresh_ExpiredToken_ThrowsUnauthorized()
    {
        var first = await Register();
        Db.RefreshTokens.Single().ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
        Db.SaveChanges();
        await Assert.ThrowsAsync<UnauthorizedAppException>(() => _sut.RefreshAsync(new RefreshTokenRequest(first.RefreshToken)));
    }

    [Fact]
    public async Task Refresh_DeactivatedUser_ThrowsForbidden()
    {
        var first = await Register();
        var user = Db.Users.Single(u => u.Email == "an@x.com");
        user.IsActive = false;
        Db.SaveChanges();
        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.RefreshAsync(new RefreshTokenRequest(first.RefreshToken)));
    }

    // ---- Logout / sessions ----

    [Fact]
    public async Task Logout_RevokesTheToken()
    {
        var auth = await Register();
        await _sut.LogoutAsync(auth.RefreshToken);
        Assert.NotNull(Db.RefreshTokens.Single().RevokedAt);
        await Assert.ThrowsAsync<UnauthorizedAppException>(() => _sut.RefreshAsync(new RefreshTokenRequest(auth.RefreshToken)));
    }

    [Fact]
    public async Task Logout_UnknownToken_DoesNothing() => await _sut.LogoutAsync("unknown");

    [Fact]
    public async Task Logout_Twice_KeepsOriginalRevocationTime()
    {
        var auth = await Register();
        await _sut.LogoutAsync(auth.RefreshToken);
        var first = Db.RefreshTokens.Single().RevokedAt;
        await _sut.LogoutAsync(auth.RefreshToken);
        Assert.Equal(first, Db.RefreshTokens.Single().RevokedAt);
    }

    [Fact]
    public async Task LogoutAll_RevokesAllSessionsOfThatUserOnly()
    {
        var a = await Register("a@x.com");
        await _sut.LoginAsync(new LoginRequest("a@x.com", ValidPassword));
        var b = await Register("b@x.com");
        await _sut.LogoutAllAsync(a.User.Id);
        Db.ChangeTracker.Clear();
        Assert.All(Db.RefreshTokens.Where(t => t.UserId == a.User.Id), t => Assert.NotNull(t.RevokedAt));
        Assert.All(Db.RefreshTokens.Where(t => t.UserId == b.User.Id), t => Assert.Null(t.RevokedAt));
    }

    [Fact]
    public async Task GetSessions_ListsOnlyActiveSessionsNewestFirst()
    {
        var a = await Register("a@x.com");
        await _sut.LoginAsync(new LoginRequest("a@x.com", ValidPassword));
        await _sut.LogoutAsync(a.RefreshToken);
        var sessions = await _sut.GetSessionsAsync(a.User.Id);
        Assert.Single(sessions);
    }

    [Fact]
    public async Task GetSessions_ExcludesExpiredSessions()
    {
        var a = await Register("a@x.com");
        Db.RefreshTokens.Single().ExpiresAt = DateTime.UtcNow.AddMinutes(-5);
        Db.SaveChanges();
        Assert.Empty(await _sut.GetSessionsAsync(a.User.Id));
    }

    [Fact]
    public async Task GetSessions_DoesNotShowOtherUsersSessions()
    {
        var a = await Register("a@x.com");
        await Register("b@x.com");
        Assert.Single(await _sut.GetSessionsAsync(a.User.Id));
    }

    [Fact]
    public async Task RevokeSession_RevokesTheSession()
    {
        var a = await Register("a@x.com");
        var session = Assert.Single(await _sut.GetSessionsAsync(a.User.Id));
        await _sut.RevokeSessionAsync(a.User.Id, session.Id);
        Assert.Empty(await _sut.GetSessionsAsync(a.User.Id));
    }

    [Fact]
    public async Task RevokeSession_OfAnotherUser_ThrowsNotFound()
    {
        var a = await Register("a@x.com");
        var b = await Register("b@x.com");
        var session = Assert.Single(await _sut.GetSessionsAsync(a.User.Id));
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.RevokeSessionAsync(b.User.Id, session.Id));
    }

    [Fact]
    public async Task RevokeSession_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.RevokeSessionAsync(Guid.NewGuid(), Guid.NewGuid()));

    [Fact]
    public async Task RevokeSession_AlreadyRevoked_IsANoOp()
    {
        var a = await Register("a@x.com");
        var session = Assert.Single(await _sut.GetSessionsAsync(a.User.Id));
        await _sut.RevokeSessionAsync(a.User.Id, session.Id);
        await _sut.RevokeSessionAsync(a.User.Id, session.Id);
    }

    // ---- Forgot / reset password ----

    [Fact]
    public async Task ForgotPassword_SendsEmailWithTokenAndStoresOnlyItsHash()
    {
        await Register("an@x.com");
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        var mail = Assert.Single(_email.ResetEmails);
        Assert.Equal("an@x.com", mail.To);
        var stored = Assert.Single(Db.PasswordResetTokens);
        Assert.NotEqual(mail.Token, stored.TokenHash);
        Assert.Equal(_tokens.HashToken(mail.Token), stored.TokenHash);
    }

    [Fact]
    public async Task ForgotPassword_TokenExpiresAfterConfiguredMinutes()
    {
        await Register("an@x.com");
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        var expires = Db.PasswordResetTokens.Single().ExpiresAt;
        Assert.InRange((expires - DateTime.UtcNow).TotalMinutes, 59, 61);
    }

    [Fact]
    public async Task ForgotPassword_UnknownEmail_SilentlyDoesNothing()
    {
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("ghost@x.com"));
        Assert.Empty(_email.ResetEmails);
        Assert.Empty(Db.PasswordResetTokens);
    }

    [Fact]
    public async Task ForgotPassword_GoogleOnlyAccount_SilentlyDoesNothing()
    {
        await CreateUserAsync("g@x.com", password: null);
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("g@x.com"));
        Assert.Empty(_email.ResetEmails);
    }

    [Fact]
    public async Task ForgotPassword_DeactivatedAccount_SilentlyDoesNothing()
    {
        await CreateUserAsync("off@x.com", active: false);
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("off@x.com"));
        Assert.Empty(_email.ResetEmails);
    }

    [Fact]
    public async Task ForgotPassword_SecondRequestInvalidatesTheFirstToken()
    {
        await Register("an@x.com");
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        var first = _email.ResetEmails[0].Token;
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ResetPasswordAsync(new ResetPasswordRequest(first, "NewPassword1")));
    }

    [Fact]
    public async Task ForgotPassword_EmailFailure_IsSwallowed()
    {
        await Register("an@x.com");
        _email.Fail = true;
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        Assert.Single(Db.PasswordResetTokens);
    }

    [Fact]
    public async Task ResetPassword_ChangesPasswordSoNewOneWorks()
    {
        await Register("an@x.com");
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        await _sut.ResetPasswordAsync(new ResetPasswordRequest(_email.ResetEmails[0].Token, "NewPassword1"));
        await _sut.LoginAsync(new LoginRequest("an@x.com", "NewPassword1"));
        await Assert.ThrowsAsync<UnauthorizedAppException>(() => _sut.LoginAsync(new LoginRequest("an@x.com", ValidPassword)));
    }

    [Fact]
    public async Task ResetPassword_TokenCanOnlyBeUsedOnce()
    {
        await Register("an@x.com");
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        var token = _email.ResetEmails[0].Token;
        await _sut.ResetPasswordAsync(new ResetPasswordRequest(token, "NewPassword1"));
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ResetPasswordAsync(new ResetPasswordRequest(token, "Another1Pass")));
    }

    [Fact]
    public async Task ResetPassword_RevokesAllSessions()
    {
        var auth = await Register("an@x.com");
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        await _sut.ResetPasswordAsync(new ResetPasswordRequest(_email.ResetEmails[0].Token, "NewPassword1"));
        Db.ChangeTracker.Clear();
        Assert.All(Db.RefreshTokens, t => Assert.NotNull(t.RevokedAt));
        await Assert.ThrowsAsync<UnauthorizedAppException>(() => _sut.RefreshAsync(new RefreshTokenRequest(auth.RefreshToken)));
    }

    [Fact]
    public async Task ResetPassword_UnknownToken_ThrowsBadRequest() =>
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ResetPasswordAsync(new ResetPasswordRequest("bogus", "NewPassword1")));

    [Fact]
    public async Task ResetPassword_ExpiredToken_ThrowsBadRequest()
    {
        await Register("an@x.com");
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        Db.PasswordResetTokens.Single().ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
        Db.SaveChanges();
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ResetPasswordAsync(new ResetPasswordRequest(_email.ResetEmails[0].Token, "NewPassword1")));
    }

    [Fact]
    public async Task ResetPassword_WeakPassword_ThrowsBadRequestAndKeepsTokenUsable()
    {
        await Register("an@x.com");
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        var token = _email.ResetEmails[0].Token;
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ResetPasswordAsync(new ResetPasswordRequest(token, "weak")));
        Assert.Null(Db.PasswordResetTokens.Single().UsedAt);
        await _sut.ResetPasswordAsync(new ResetPasswordRequest(token, "NewPassword1"));
    }

    [Fact]
    public async Task ResetPassword_ClearsLockout()
    {
        await Register("an@x.com");
        for (var i = 0; i < 5; i++)
            await Assert.ThrowsAsync<UnauthorizedAppException>(() => _sut.LoginAsync(new LoginRequest("an@x.com", "Wrong-pass1")));
        await _sut.ForgotPasswordAsync(new ForgotPasswordRequest("an@x.com"));
        await _sut.ResetPasswordAsync(new ResetPasswordRequest(_email.ResetEmails[0].Token, "NewPassword1"));
        await _sut.LoginAsync(new LoginRequest("an@x.com", "NewPassword1"));
    }
}

public class UserServiceTests : IdentityTestBase
{
    private readonly UserService _sut;

    public UserServiceTests() => _sut = new UserService(Users, Db);

    [Fact]
    public async Task GetProfile_ReturnsUserWithRoles()
    {
        var user = await CreateUserAsync("an@x.com", role: Roles.User);
        var result = await _sut.GetProfileAsync(user.Id);
        Assert.Equal("an@x.com", result.Email);
        Assert.Equal(["User"], result.Roles);
    }

    [Fact]
    public async Task GetProfile_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetProfileAsync(Guid.NewGuid()));

    [Fact]
    public async Task GetProfile_DeactivatedUser_ThrowsForbidden()
    {
        var user = await CreateUserAsync("off@x.com", active: false);
        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.GetProfileAsync(user.Id));
    }

    [Theory]
    [InlineData("0901 234 567", "0901234567")]
    [InlineData("+84 901 234 567", "0901234567")]
    [InlineData("", null)]
    public async Task UpdateProfile_StoresPhoneInCanonicalForm(string phone, string? expected)
    {
        var user = await CreateUserAsync("an@x.com");
        var result = await _sut.UpdateProfileAsync(user.Id, new UpdateProfileRequest("An", phone));
        Assert.Equal(expected, result.PhoneNumber);
    }

    [Fact]
    public async Task UpdateProfile_TrimsName()
    {
        var user = await CreateUserAsync("an@x.com");
        var result = await _sut.UpdateProfileAsync(user.Id, new UpdateProfileRequest("  An  ", null));
        Assert.Equal("An", result.FullName);
    }

    [Fact]
    public async Task UpdateProfile_ValidAvatarUrl_IsStored()
    {
        var user = await CreateUserAsync("an@x.com");
        var result = await _sut.UpdateProfileAsync(user.Id, new UpdateProfileRequest("An", null, "https://cdn.x.com/a.png"));
        Assert.Equal("https://cdn.x.com/a.png", result.AvatarUrl);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task UpdateProfile_EmptyAvatar_ClearsIt(string? url)
    {
        var user = await CreateUserAsync("an@x.com");
        user.AvatarUrl = "https://cdn.x.com/a.png";
        await Users.UpdateAsync(user);
        var result = await _sut.UpdateProfileAsync(user.Id, new UpdateProfileRequest("An", null, url));
        Assert.Null(result.AvatarUrl);
    }

    [Theory]
    [InlineData("ftp://x.com/a.png")]
    [InlineData("javascript:alert(1)")]
    [InlineData("/relative/path.png")]
    public async Task UpdateProfile_NonHttpAvatar_ThrowsBadRequest(string url)
    {
        var user = await CreateUserAsync("an@x.com");
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.UpdateProfileAsync(user.Id, new UpdateProfileRequest("An", null, url)));
    }

    [Fact]
    public async Task UpdateProfile_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.UpdateProfileAsync(Guid.NewGuid(), new UpdateProfileRequest("An", null)));

    [Fact]
    public async Task UpdateTimeZone_ValidZone_IsStored()
    {
        var user = await CreateUserAsync("an@x.com");
        var result = await _sut.UpdateTimeZoneAsync(user.Id, new UpdateTimeZoneRequest(" UTC "));
        Assert.Equal("UTC", result.TimeZoneId);
    }

    [Theory]
    [InlineData("Not/AZone")]
    [InlineData("garbage")]
    public async Task UpdateTimeZone_UnknownZone_ThrowsBadRequest(string zone)
    {
        var user = await CreateUserAsync("an@x.com");
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.UpdateTimeZoneAsync(user.Id, new UpdateTimeZoneRequest(zone)));
    }

    [Fact]
    public async Task ChangePassword_SameAsCurrent_ThrowsBadRequest()
    {
        var user = await CreateUserAsync("an@x.com");
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ChangePasswordAsync(user.Id, new ChangePasswordRequest(ValidPassword, ValidPassword)));
    }

    [Fact]
    public async Task ChangePassword_GoogleAccount_ThrowsBadRequest()
    {
        var user = await CreateUserAsync("g@x.com", password: null);
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ChangePasswordAsync(user.Id, new ChangePasswordRequest("Whatever1", "NewPassword1")));
    }

    [Fact]
    public async Task ChangePassword_WrongCurrentPassword_ThrowsBadRequest()
    {
        var user = await CreateUserAsync("an@x.com");
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ChangePasswordAsync(user.Id, new ChangePasswordRequest("Wrong-pass1", "NewPassword1")));
    }

    [Fact]
    public async Task ChangePassword_WeakNewPassword_ThrowsBadRequest()
    {
        var user = await CreateUserAsync("an@x.com");
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.ChangePasswordAsync(user.Id, new ChangePasswordRequest(ValidPassword, "weakpass")));
    }

    [Fact]
    public async Task ChangePassword_Success_ChangesPasswordAndRevokesSessions()
    {
        var user = await CreateUserAsync("an@x.com");
        Db.RefreshTokens.Add(new RefreshToken { UserId = user.Id, TokenHash = "h1", ExpiresAt = DateTime.UtcNow.AddDays(1) });
        Db.SaveChanges();
        await _sut.ChangePasswordAsync(user.Id, new ChangePasswordRequest(ValidPassword, "NewPassword1"));
        Assert.True(await Users.CheckPasswordAsync(user, "NewPassword1"));
        Db.ChangeTracker.Clear();
        Assert.NotNull(Db.RefreshTokens.Single().RevokedAt);
    }

    [Fact]
    public async Task ChangePassword_DoesNotTouchOtherUsersSessions()
    {
        var user = await CreateUserAsync("an@x.com");
        var other = await CreateUserAsync("other2@x.com");
        Db.RefreshTokens.Add(new RefreshToken { UserId = other.Id, TokenHash = "h2", ExpiresAt = DateTime.UtcNow.AddDays(1) });
        Db.SaveChanges();
        await _sut.ChangePasswordAsync(user.Id, new ChangePasswordRequest(ValidPassword, "NewPassword1"));
        Db.ChangeTracker.Clear();
        Assert.Null(Db.RefreshTokens.Single().RevokedAt);
    }
}

public class AdminUserServiceTests : IdentityTestBase
{
    private readonly FakeAudit _audit = new();
    private readonly FakeCurrentUser _current = new();
    private readonly AdminUserService _sut;
    private ApplicationUser _admin = null!;

    public AdminUserServiceTests()
    {
        _admin = CreateUserAsync("admin@x.com", role: Roles.Admin).GetAwaiter().GetResult();
        _current.UserId = _admin.Id;
        _current.IsAdmin = true;
        var quota = new AIQuotaService(Db, _current, _audit);
        _sut = new AdminUserService(Db, Users, _current, _audit, quota);
    }

    // ---- GetPaged / GetById ----

    [Fact]
    public async Task GetPaged_ReturnsAllUsersWithRolesAndQuota()
    {
        await CreateUserAsync("a@x.com", role: Roles.User);
        var result = await _sut.GetPagedAsync(new AdminUserQuery());
        Assert.Equal(4, result.TotalCount); // 2 seeded + admin + a
        var a = result.Items.Single(u => u.Email == "a@x.com");
        Assert.Equal(["User"], a.Roles);
        Assert.Equal(20, a.AiQuota.EffectiveLimit);
    }

    [Fact]
    public async Task GetPaged_SearchMatchesNameOrEmail()
    {
        await CreateUserAsync("alice@x.com");
        await CreateUserAsync("bob@x.com");
        var result = await _sut.GetPagedAsync(new AdminUserQuery { Search = "alice" });
        Assert.Equal("alice@x.com", Assert.Single(result.Items).Email);
    }

    [Fact]
    public async Task GetPaged_FiltersByActiveFlag()
    {
        await CreateUserAsync("off@x.com", active: false);
        var inactive = await _sut.GetPagedAsync(new AdminUserQuery { IsActive = false });
        Assert.Equal("off@x.com", Assert.Single(inactive.Items).Email);
        var active = await _sut.GetPagedAsync(new AdminUserQuery { IsActive = true });
        Assert.DoesNotContain(active.Items, u => u.Email == "off@x.com");
    }

    [Fact]
    public async Task GetPaged_NewestUsersFirst()
    {
        var old = await CreateUserAsync("old@x.com");
        var recent = await CreateUserAsync("recent@x.com");
        Db.Users.Single(u => u.Id == old.Id).CreatedAt = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        Db.Users.Single(u => u.Id == recent.Id).CreatedAt = DateTime.UtcNow.AddYears(1);
        Db.SaveChanges();
        var result = await _sut.GetPagedAsync(new AdminUserQuery { PageSize = 100 });
        Assert.Equal("recent@x.com", result.Items[0].Email);
        Assert.Equal("old@x.com", result.Items[^1].Email);
    }

    [Fact]
    public async Task GetPaged_Pages()
    {
        var result = await _sut.GetPagedAsync(new AdminUserQuery { Page = 2, PageSize = 2 });
        Assert.Single(result.Items);
        Assert.Equal(3, result.TotalCount);
    }

    [Fact]
    public async Task GetById_ReturnsUser()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        var result = await _sut.GetByIdAsync(user.Id);
        Assert.Equal("a@x.com", result.Email);
        Assert.True(result.IsActive);
    }

    [Fact]
    public async Task GetById_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(Guid.NewGuid()));

    // ---- Lock ----

    [Fact]
    public async Task Lock_DeactivatesUserAndRecordsReason()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        var result = await _sut.LockAsync(user.Id, new LockUserRequest("  spam  "));
        Assert.False(result.IsActive);
        Assert.Equal("spam", result.LockedReason);
        Assert.NotNull(result.LockedAt);
    }

    [Fact]
    public async Task Lock_RevokesRefreshTokens()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        Db.RefreshTokens.Add(new RefreshToken { UserId = user.Id, TokenHash = "h", ExpiresAt = DateTime.UtcNow.AddDays(1) });
        Db.SaveChanges();
        await _sut.LockAsync(user.Id, new LockUserRequest("x"));
        Db.ChangeTracker.Clear();
        Assert.NotNull(Db.RefreshTokens.Single().RevokedAt);
    }

    [Fact]
    public async Task Lock_WritesAuditEntry()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        await _sut.LockAsync(user.Id, new LockUserRequest("spam"));
        var entry = Assert.Single(_audit.Entries);
        Assert.Equal("LockUser", entry.Action);
        Assert.Equal(user.Id, entry.TargetId);
        Assert.Equal("spam", entry.Detail);
    }

    [Fact]
    public async Task Lock_Self_ThrowsBadRequest() =>
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.LockAsync(_admin.Id, new LockUserRequest("x")));

    [Fact]
    public async Task Lock_AnotherAdmin_ThrowsForbidden()
    {
        var other = await CreateUserAsync("admin2@x.com", role: Roles.Admin);
        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.LockAsync(other.Id, new LockUserRequest("x")));
    }

    [Fact]
    public async Task Lock_AlreadyLocked_ThrowsConflict()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        await _sut.LockAsync(user.Id, new LockUserRequest("x"));
        await Assert.ThrowsAsync<ConflictException>(() => _sut.LockAsync(user.Id, new LockUserRequest("again")));
    }

    [Fact]
    public async Task Lock_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.LockAsync(Guid.NewGuid(), new LockUserRequest("x")));

    // ---- Unlock ----

    [Fact]
    public async Task Unlock_RestoresAccountAndClearsLockInfo()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        await _sut.LockAsync(user.Id, new LockUserRequest("x"));
        var result = await _sut.UnlockAsync(user.Id);
        Assert.True(result.IsActive);
        Assert.Null(result.LockedReason);
        Assert.Null(result.LockedAt);
        Assert.Equal(["LockUser", "UnlockUser"], _audit.Entries.Select(e => e.Action));
    }

    [Fact]
    public async Task Unlock_ClearsLoginLockout()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        await Users.SetLockoutEndDateAsync(user, DateTimeOffset.UtcNow.AddHours(1));
        await _sut.LockAsync(user.Id, new LockUserRequest("x"));
        await _sut.UnlockAsync(user.Id);
        Assert.False(await Users.IsLockedOutAsync(user));
    }

    [Fact]
    public async Task Unlock_ActiveUser_ReturnsWithoutAudit()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        var result = await _sut.UnlockAsync(user.Id);
        Assert.True(result.IsActive);
        Assert.Empty(_audit.Entries);
    }

    [Fact]
    public async Task Unlock_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.UnlockAsync(Guid.NewGuid()));

    // ---- AI quota ----

    [Fact]
    public async Task SetAIQuota_AppliesLimit()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        var result = await _sut.SetAIQuotaAsync(user.Id, new SetAIQuotaRequest(50));
        Assert.Equal(50, result.AiQuota.CustomLimit);
        Assert.Equal(50, result.AiQuota.EffectiveLimit);
    }

    [Fact]
    public async Task SetAIQuota_NullReturnsToDefault()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        await _sut.SetAIQuotaAsync(user.Id, new SetAIQuotaRequest(50));
        var result = await _sut.SetAIQuotaAsync(user.Id, new SetAIQuotaRequest(null));
        Assert.Null(result.AiQuota.CustomLimit);
        Assert.Equal(20, result.AiQuota.EffectiveLimit);
    }

    [Fact]
    public async Task SetAIQuota_InvalidLimit_ThrowsBadRequest()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.SetAIQuotaAsync(user.Id, new SetAIQuotaRequest(33)));
    }

    [Fact]
    public async Task SetAIQuota_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.SetAIQuotaAsync(Guid.NewGuid(), new SetAIQuotaRequest(10)));

    [Fact]
    public async Task SetAIQuota_Unlimited_IsReportedAsUnlimited()
    {
        var user = await CreateUserAsync("a@x.com", role: Roles.User);
        var result = await _sut.SetAIQuotaAsync(user.Id, new SetAIQuotaRequest(-1));
        Assert.True(result.AiQuota.IsUnlimited);
        Assert.Null(result.AiQuota.EffectiveLimit);
    }
}

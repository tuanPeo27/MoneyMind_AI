using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Identity;

namespace backend.Tests;

public class DateRangeTests
{
    [Fact]
    public void AsUtc_UtcValueIsReturnedUnchanged()
    {
        var value = new DateTime(2025, 3, 1, 10, 0, 0, DateTimeKind.Utc);
        Assert.Equal(value, DateRange.AsUtc(value));
        Assert.Equal(DateTimeKind.Utc, DateRange.AsUtc(value).Kind);
    }

    [Fact]
    public void AsUtc_UnspecifiedValueKeepsTicksAndBecomesUtc()
    {
        var value = new DateTime(2025, 3, 1, 10, 0, 0, DateTimeKind.Unspecified);
        var result = DateRange.AsUtc(value);
        Assert.Equal(value.Ticks, result.Ticks);
        Assert.Equal(DateTimeKind.Utc, result.Kind);
    }

    [Fact]
    public void AsUtc_LocalValueIsConvertedToUniversalTime()
    {
        var value = new DateTime(2025, 3, 1, 10, 0, 0, DateTimeKind.Local);
        Assert.Equal(value.ToUniversalTime(), DateRange.AsUtc(value));
    }

    [Theory]
    [InlineData(2025, 1, 1)]
    [InlineData(2024, 2, 28)]
    [InlineData(2024, 2, 29)]
    [InlineData(2025, 12, 31)]
    public void EndExclusive_DateOnlyCoversWholeDay(int y, int m, int d)
    {
        var to = new DateTime(y, m, d, 0, 0, 0, DateTimeKind.Utc);
        Assert.Equal(to.AddDays(1), DateRange.EndExclusive(to));
    }

    [Theory]
    [InlineData(1, 0, 0)]
    [InlineData(23, 59, 59)]
    [InlineData(0, 0, 1)]
    [InlineData(12, 30, 0)]
    public void EndExclusive_TimeOfDayAddsOneTick(int h, int mi, int s)
    {
        var to = new DateTime(2025, 5, 5, h, mi, s, DateTimeKind.Utc);
        Assert.Equal(to.AddTicks(1), DateRange.EndExclusive(to));
    }

    [Fact]
    public void Bounds_ReturnsStartAndExclusiveEnd()
    {
        var (start, end) = DateRange.Bounds(new DateTime(2025, 1, 1), new DateTime(2025, 1, 31));
        Assert.Equal(new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc), start);
        Assert.Equal(new DateTime(2025, 2, 1), end);
    }

    [Fact]
    public void Bounds_SameDateOnlyValues_CoverOneDay()
    {
        var day = new DateTime(2025, 6, 10);
        var (start, end) = DateRange.Bounds(day, day);
        Assert.Equal(TimeSpan.FromDays(1), end - start);
    }

    [Fact]
    public void Bounds_ToBeforeFrom_ThrowsBadRequest()
    {
        Assert.Throws<BadRequestException>(() => DateRange.Bounds(new DateTime(2025, 2, 1), new DateTime(2025, 1, 1)));
    }

    [Fact]
    public void Bounds_SameInstantWithTime_IsValid()
    {
        var instant = new DateTime(2025, 2, 1, 8, 0, 0, DateTimeKind.Utc);
        var (start, end) = DateRange.Bounds(instant, instant);
        Assert.True(end > start);
    }

    [Fact]
    public void Bounds_StartIsUtc()
    {
        var (start, _) = DateRange.Bounds(new DateTime(2025, 1, 1), new DateTime(2025, 1, 2));
        Assert.Equal(DateTimeKind.Utc, start.Kind);
    }

    [Theory]
    [InlineData(2025, 1, 1)]
    [InlineData(2024, 2, 29)]
    [InlineData(2030, 12, 31)]
    public void StartOfDay_IsMidnightUtc(int y, int m, int d)
    {
        var result = DateRange.StartOfDay(new DateOnly(y, m, d));
        Assert.Equal(new DateTime(y, m, d, 0, 0, 0, DateTimeKind.Utc), result);
        Assert.Equal(TimeSpan.Zero, result.TimeOfDay);
    }
}

public class SecurityHelperTests
{
    [Fact]
    public void GenerateToken_DefaultLengthIs86Characters() =>
        Assert.Equal(86, SecurityHelper.GenerateToken().Length);

    [Theory]
    [InlineData(3, 4)]
    [InlineData(6, 8)]
    [InlineData(32, 43)]
    [InlineData(64, 86)]
    public void GenerateToken_LengthFollowsByteCount(int bytes, int expectedLength) =>
        Assert.Equal(expectedLength, SecurityHelper.GenerateToken(bytes).Length);

    [Fact]
    public void GenerateToken_IsUrlSafe()
    {
        for (var i = 0; i < 200; i++)
        {
            var token = SecurityHelper.GenerateToken();
            Assert.DoesNotContain('+', token);
            Assert.DoesNotContain('/', token);
            Assert.DoesNotContain('=', token);
        }
    }

    [Fact]
    public void GenerateToken_ProducesUniqueValues()
    {
        var tokens = Enumerable.Range(0, 100).Select(_ => SecurityHelper.GenerateToken()).ToHashSet();
        Assert.Equal(100, tokens.Count);
    }

    [Fact]
    public void Sha256_MatchesKnownVectorForAbc() =>
        Assert.Equal("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD", SecurityHelper.Sha256("abc"));

    [Fact]
    public void Sha256_MatchesKnownVectorForEmptyString() =>
        Assert.Equal("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855", SecurityHelper.Sha256(""));

    [Fact]
    public void Sha256_IsDeterministic() =>
        Assert.Equal(SecurityHelper.Sha256("token"), SecurityHelper.Sha256("token"));

    [Fact]
    public void Sha256_DifferentInputsGiveDifferentHashes() =>
        Assert.NotEqual(SecurityHelper.Sha256("a"), SecurityHelper.Sha256("b"));

    [Theory]
    [InlineData("a")]
    [InlineData("a much longer value with spaces and unicode: tiền Việt")]
    public void Sha256_Is64UpperCaseHexCharacters(string value)
    {
        var hash = SecurityHelper.Sha256(value);
        Assert.Equal(64, hash.Length);
        Assert.Matches("^[0-9A-F]{64}$", hash);
    }

    [Fact]
    public void Sha256_IsCaseSensitiveOnInput() =>
        Assert.NotEqual(SecurityHelper.Sha256("Abc"), SecurityHelper.Sha256("abc"));

    [Fact]
    public void Roles_HaveExpectedNames()
    {
        Assert.Equal("Admin", Roles.Admin);
        Assert.Equal("User", Roles.User);
    }
}

public class AIQuotaRuleTests
{
    [Theory]
    [InlineData(10)]
    [InlineData(20)]
    [InlineData(50)]
    [InlineData(-1)]
    public void IsAllowed_AcceptsOfferedLimits(int limit) => Assert.True(AIQuota.IsAllowed(limit));

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(5)]
    [InlineData(15)]
    [InlineData(21)]
    [InlineData(100)]
    [InlineData(-2)]
    [InlineData(int.MaxValue)]
    [InlineData(int.MinValue)]
    public void IsAllowed_RejectsOtherValues(int limit) => Assert.False(AIQuota.IsAllowed(limit));

    [Fact]
    public void AllowedLimits_HasFourOptions() => Assert.Equal(4, AIQuota.AllowedLimits.Count);

    [Fact]
    public void FallbackDefault_IsAnAllowedLimit() => Assert.True(AIQuota.IsAllowed(AIQuota.FallbackDefault));

    [Fact]
    public void Unlimited_IsMinusOne() => Assert.Equal(-1, AIQuota.Unlimited);

    [Fact]
    public void ChatTaskName_IsChat() => Assert.Equal("Chat", AITasks.Chat);

    [Fact]
    public void DefaultSettingKey_IsStable() =>
        Assert.Equal("ai.default_daily_message_limit", AIQuota.DefaultSettingKey);
}

public class AIQuotaStatusTests
{
    private static readonly DateTime Reset = new(2025, 1, 2, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void NullDailyLimit_IsUnlimitedWithNoRemaining()
    {
        var status = new AIQuotaStatus(null, null, 5, Reset);
        Assert.True(status.IsUnlimited);
        Assert.Null(status.Remaining);
    }

    [Theory]
    [InlineData(20, 0, 20)]
    [InlineData(20, 5, 15)]
    [InlineData(20, 20, 0)]
    [InlineData(20, 25, 0)]
    [InlineData(10, 9, 1)]
    public void Remaining_NeverGoesBelowZero(int limit, int used, int expected)
    {
        var status = new AIQuotaStatus(null, limit, used, Reset);
        Assert.False(status.IsUnlimited);
        Assert.Equal(expected, status.Remaining);
    }

    [Fact]
    public void ToUsage_MapsAllFields()
    {
        var usage = new AIQuotaStatus(10, 10, 4, Reset).ToUsage();
        Assert.False(usage.IsUnlimited);
        Assert.Equal(10, usage.DailyLimit);
        Assert.Equal(4, usage.Used);
        Assert.Equal(6, usage.Remaining);
        Assert.Equal(Reset, usage.ResetsAt);
    }

    [Fact]
    public void ToUsage_Unlimited()
    {
        var usage = new AIQuotaStatus(-1, null, 100, Reset).ToUsage();
        Assert.True(usage.IsUnlimited);
        Assert.Null(usage.DailyLimit);
        Assert.Null(usage.Remaining);
    }

    [Fact]
    public void ToAdmin_ExposesCustomAndEffectiveLimit()
    {
        var admin = new AIQuotaStatus(50, 50, 7, Reset).ToAdmin();
        Assert.Equal(50, admin.CustomLimit);
        Assert.Equal(50, admin.EffectiveLimit);
        Assert.Equal(7, admin.UsedToday);
        Assert.False(admin.IsUnlimited);
    }

    [Fact]
    public void ToAdmin_UserOnDefault_HasNullCustomLimit()
    {
        var admin = new AIQuotaStatus(null, 20, 0, Reset).ToAdmin();
        Assert.Null(admin.CustomLimit);
        Assert.Equal(20, admin.EffectiveLimit);
    }
}

public class AppExceptionTests
{
    [Fact]
    public void BadRequest_Is400() => Assert.Equal(400, new BadRequestException("x").StatusCode);
    [Fact]
    public void Unauthorized_Is401() => Assert.Equal(401, new UnauthorizedAppException().StatusCode);
    [Fact]
    public void Forbidden_Is403() => Assert.Equal(403, new ForbiddenException().StatusCode);
    [Fact]
    public void NotFound_Is404() => Assert.Equal(404, new NotFoundException().StatusCode);
    [Fact]
    public void Conflict_Is409() => Assert.Equal(409, new ConflictException("x").StatusCode);
    [Fact]
    public void TooManyRequests_Is429() => Assert.Equal(429, new TooManyRequestsException("x").StatusCode);
    [Fact]
    public void ServiceUnavailable_Is503() => Assert.Equal(503, new ServiceUnavailableException("x").StatusCode);

    [Fact]
    public void DefaultMessages_AreProvided()
    {
        Assert.Equal("Unauthorized.", new UnauthorizedAppException().Message);
        Assert.Equal("Forbidden.", new ForbiddenException().Message);
        Assert.Equal("Resource not found.", new NotFoundException().Message);
    }

    [Fact]
    public void CustomMessage_IsKept() => Assert.Equal("hello", new BadRequestException("hello").Message);

    [Fact]
    public void AllExceptions_DeriveFromAppException()
    {
        AppException[] all =
        [
            new BadRequestException("x"), new UnauthorizedAppException(), new ForbiddenException(),
            new NotFoundException(), new ConflictException("x"), new TooManyRequestsException("x"),
            new ServiceUnavailableException("x")
        ];
        Assert.All(all, e => Assert.IsAssignableFrom<Exception>(e));
    }
}

public class UserMappingTests
{
    [Fact]
    public void HasPassword_TrueWhenHashPresent() =>
        Assert.True(new ApplicationUser { PasswordHash = "hash" }.HasPassword());

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void HasPassword_FalseForGoogleAccounts(string? hash) =>
        Assert.False(new ApplicationUser { PasswordHash = hash }.HasPassword());

    [Fact]
    public void ToResponse_MapsProfileFields()
    {
        var created = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var user = new ApplicationUser
        {
            FullName = "An", Email = "an@x.com", PhoneNumber = "0901234567", AvatarUrl = "https://a/b.png",
            TimeZoneId = "UTC", CreatedAt = created, PasswordHash = "h"
        };
        var response = user.ToResponse(["User"]);
        Assert.Equal(user.Id, response.Id);
        Assert.Equal("An", response.FullName);
        Assert.Equal("an@x.com", response.Email);
        Assert.Equal("0901234567", response.PhoneNumber);
        Assert.Equal("https://a/b.png", response.AvatarUrl);
        Assert.Equal("UTC", response.TimeZoneId);
        Assert.Equal(created, response.CreatedAt);
        Assert.True(response.HasPassword);
        Assert.Equal(["User"], response.Roles);
    }

    [Fact]
    public void ToResponse_NullEmailBecomesEmptyString() =>
        Assert.Equal(string.Empty, new ApplicationUser { Email = null }.ToResponse([]).Email);

    [Fact]
    public void ToResponse_KeepsAllRoles() =>
        Assert.Equal(["Admin", "User"], new ApplicationUser().ToResponse(["Admin", "User"]).Roles);

    [Fact]
    public void ToResponse_UserWithoutPassword_HasPasswordFalse() =>
        Assert.False(new ApplicationUser().ToResponse([]).HasPassword);

    [Fact]
    public void Describe_JoinsErrorDescriptions()
    {
        var result = IdentityResult.Failed(
            new IdentityError { Description = "Too short." }, new IdentityError { Description = "Needs digit." });
        Assert.Equal("Too short. Needs digit.", result.Describe());
    }

    [Fact]
    public void Describe_SuccessIsEmpty() => Assert.Equal(string.Empty, IdentityResult.Success.Describe());
}

public class PagedResultTests
{
    private static PagedResult<int> Page(int pageSize, int total) => new([], 1, pageSize, total);

    [Theory]
    [InlineData(20, 0, 0)]
    [InlineData(20, 1, 1)]
    [InlineData(20, 20, 1)]
    [InlineData(20, 21, 2)]
    [InlineData(10, 95, 10)]
    [InlineData(1, 5, 5)]
    [InlineData(100, 101, 2)]
    public void TotalPages_RoundsUp(int pageSize, int total, int expected) =>
        Assert.Equal(expected, Page(pageSize, total).TotalPages);

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void TotalPages_InvalidPageSizeIsZero(int pageSize) =>
        Assert.Equal(0, Page(pageSize, 50).TotalPages);
}

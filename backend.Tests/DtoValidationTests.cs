using System.ComponentModel.DataAnnotations;
using System.Globalization;
using backend.DTOs.Requests;
using backend.Models;

namespace backend.Tests;

public class DtoValidationTests
{
    internal static bool IsValid(object instance)
    {
        var previous = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        try
        {
            var propertiesValid = Validator.TryValidateObject(
                instance, new ValidationContext(instance), [], validateAllProperties: true);
            return propertiesValid && ConstructorParametersAreValid(instance);
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
        }
    }

    /// <summary>
    /// Some records put attributes on the constructor parameter (not the property), which ASP.NET model binding
    /// validates but Validator.TryValidateObject does not. This mirrors that behavior.
    /// </summary>
    private static bool ConstructorParametersAreValid(object instance)
    {
        var type = instance.GetType();
        var ctor = type.GetConstructors().OrderByDescending(c => c.GetParameters().Length).First();
        foreach (var parameter in ctor.GetParameters())
        {
            var attributes = parameter.GetCustomAttributes(typeof(ValidationAttribute), true).Cast<ValidationAttribute>().ToList();
            if (attributes.Count == 0) continue;
            var value = type.GetProperty(parameter.Name!)!.GetValue(instance);
            var context = new ValidationContext(instance) { MemberName = parameter.Name };
            if (!Validator.TryValidateValue(value!, context, [], attributes)) return false;
        }
        return true;
    }

    private static string Text(int length) => new('a', length);

    // ---- RegisterRequest ----

    private static RegisterRequest Register(string name = "An", string email = "an@x.com", string password = "password1") =>
        new(name, email, password);

    [Fact] public void Register_ValidRequest_Passes() => Assert.True(IsValid(Register()));
    [Fact] public void Register_NullName_Fails() => Assert.False(IsValid(Register(name: null!)));
    [Fact] public void Register_EmptyName_Fails() => Assert.False(IsValid(Register(name: "")));
    [Fact] public void Register_Name100Chars_Passes() => Assert.True(IsValid(Register(name: Text(100))));
    [Fact] public void Register_Name101Chars_Fails() => Assert.False(IsValid(Register(name: Text(101))));

    [Theory]
    [InlineData("a@b.com", true)]
    [InlineData("first.last@sub.domain.vn", true)]
    [InlineData("user+tag@gmail.com", true)]
    [InlineData("plainaddress", false)]
    [InlineData("@no-local.com", false)]
    [InlineData("two@@at.com", false)]
    [InlineData("", false)]
    public void Register_EmailFormat(string email, bool valid) =>
        Assert.Equal(valid, IsValid(Register(email: email)));

    [Fact]
    public void Register_EmailLongerThan256_Fails() =>
        Assert.False(IsValid(Register(email: Text(251) + "@x.com")));

    [Theory]
    [InlineData(0, false)]
    [InlineData(7, false)]
    [InlineData(8, true)]
    [InlineData(64, true)]
    [InlineData(128, true)]
    [InlineData(129, false)]
    public void Register_PasswordLength(int length, bool valid) =>
        Assert.Equal(valid, IsValid(Register(password: Text(length))));

    [Fact] public void Register_NullPassword_Fails() => Assert.False(IsValid(Register(password: null!)));

    // ---- LoginRequest ----

    [Fact] public void Login_Valid_Passes() => Assert.True(IsValid(new LoginRequest("a@b.com", "x")));
    [Fact] public void Login_BadEmail_Fails() => Assert.False(IsValid(new LoginRequest("nope", "x")));
    [Fact] public void Login_EmptyPassword_Fails() => Assert.False(IsValid(new LoginRequest("a@b.com", "")));
    [Fact] public void Login_NullEmail_Fails() => Assert.False(IsValid(new LoginRequest(null!, "x")));

    // ---- Token / password reset ----

    [Fact] public void GoogleLogin_EmptyToken_Fails() => Assert.False(IsValid(new GoogleLoginRequest("")));
    [Fact] public void GoogleLogin_WithToken_Passes() => Assert.True(IsValid(new GoogleLoginRequest("jwt")));
    [Fact] public void Refresh_EmptyToken_Fails() => Assert.False(IsValid(new RefreshTokenRequest("")));
    [Fact] public void Refresh_WithToken_Passes() => Assert.True(IsValid(new RefreshTokenRequest("t")));
    [Fact] public void Logout_EmptyToken_Fails() => Assert.False(IsValid(new LogoutRequest("")));
    [Fact] public void Logout_WithToken_Passes() => Assert.True(IsValid(new LogoutRequest("t")));
    [Fact] public void ForgotPassword_ValidEmail_Passes() => Assert.True(IsValid(new ForgotPasswordRequest("a@b.com")));
    [Fact] public void ForgotPassword_InvalidEmail_Fails() => Assert.False(IsValid(new ForgotPasswordRequest("abc")));
    [Fact] public void ResetPassword_Valid_Passes() => Assert.True(IsValid(new ResetPasswordRequest("tok", "password1")));
    [Fact] public void ResetPassword_EmptyToken_Fails() => Assert.False(IsValid(new ResetPasswordRequest("", "password1")));
    [Fact] public void ResetPassword_ShortPassword_Fails() => Assert.False(IsValid(new ResetPasswordRequest("tok", "short")));
    [Fact] public void ChangePassword_Valid_Passes() => Assert.True(IsValid(new ChangePasswordRequest("old", "password1")));
    [Fact] public void ChangePassword_EmptyCurrent_Fails() => Assert.False(IsValid(new ChangePasswordRequest("", "password1")));
    [Fact] public void ChangePassword_ShortNew_Fails() => Assert.False(IsValid(new ChangePasswordRequest("old", "1234567")));

    // ---- Profile ----

    [Fact] public void Profile_Valid_Passes() => Assert.True(IsValid(new UpdateProfileRequest("An", "0901234567")));
    [Fact] public void Profile_EmptyName_Fails() => Assert.False(IsValid(new UpdateProfileRequest("", null)));
    [Fact] public void Profile_Name101_Fails() => Assert.False(IsValid(new UpdateProfileRequest(Text(101), null)));
    [Fact] public void Profile_NullPhoneAndAvatar_Passes() => Assert.True(IsValid(new UpdateProfileRequest("An", null)));
    [Fact] public void Profile_ValidAvatarUrl_Passes() =>
        Assert.True(IsValid(new UpdateProfileRequest("An", null, "https://cdn.x.com/a.png")));
    [Fact] public void Profile_InvalidAvatarUrl_Fails() =>
        Assert.False(IsValid(new UpdateProfileRequest("An", null, "not a url")));
    [Fact] public void Profile_AvatarUrlOver2048_Fails() =>
        Assert.False(IsValid(new UpdateProfileRequest("An", null, "https://x.com/" + Text(2048))));
    [Fact] public void Profile_PhoneWithLetters_Fails() =>
        Assert.False(IsValid(new UpdateProfileRequest("An", "09012345ab")));

    [Fact] public void TimeZone_Valid_Passes() => Assert.True(IsValid(new UpdateTimeZoneRequest("Asia/Ho_Chi_Minh")));
    [Fact] public void TimeZone_Empty_Fails() => Assert.False(IsValid(new UpdateTimeZoneRequest("")));
    [Fact] public void TimeZone_100Chars_Passes() => Assert.True(IsValid(new UpdateTimeZoneRequest(Text(100))));
    [Fact] public void TimeZone_101Chars_Fails() => Assert.False(IsValid(new UpdateTimeZoneRequest(Text(101))));

    // ---- Accounts and categories ----

    [Fact] public void CreateAccount_Valid_Passes() =>
        Assert.True(IsValid(new CreateAccountRequest("Cash", AccountType.Cash, 0m)));
    [Fact] public void CreateAccount_EmptyName_Fails() =>
        Assert.False(IsValid(new CreateAccountRequest("", AccountType.Cash, 0m)));
    [Fact] public void CreateAccount_Name101_Fails() =>
        Assert.False(IsValid(new CreateAccountRequest(Text(101), AccountType.Cash, 0m)));

    [Theory]
    [InlineData("", false)]
    [InlineData("VN", false)]
    [InlineData("VND", true)]
    [InlineData("VNDD", false)]
    public void CreateAccount_CurrencyMustBeThreeCharacters(string currency, bool valid) =>
        Assert.Equal(valid, IsValid(new CreateAccountRequest("Cash", AccountType.Cash, 0m, currency)));

    [Fact] public void UpdateAccount_Valid_Passes() =>
        Assert.True(IsValid(new UpdateAccountRequest("Cash", AccountType.Bank, false)));
    [Fact] public void UpdateAccount_EmptyName_Fails() =>
        Assert.False(IsValid(new UpdateAccountRequest("", AccountType.Bank, false)));

    [Fact] public void Category_Valid_Passes() =>
        Assert.True(IsValid(new UpsertCategoryRequest("Food", CategoryType.Expense, "icon", "#fff")));
    [Fact] public void Category_EmptyName_Fails() =>
        Assert.False(IsValid(new UpsertCategoryRequest("", CategoryType.Expense, null, null)));
    [Fact] public void Category_Name101_Fails() =>
        Assert.False(IsValid(new UpsertCategoryRequest(Text(101), CategoryType.Expense, null, null)));
    [Fact] public void Category_Icon51_Fails() =>
        Assert.False(IsValid(new UpsertCategoryRequest("A", CategoryType.Expense, Text(51), null)));
    [Fact] public void Category_Icon50_Passes() =>
        Assert.True(IsValid(new UpsertCategoryRequest("A", CategoryType.Expense, Text(50), null)));
    [Fact] public void Category_Color51_Fails() =>
        Assert.False(IsValid(new UpsertCategoryRequest("A", CategoryType.Expense, null, Text(51))));

    // ---- Transactions ----

    private static UpsertTransactionRequest Tx(decimal amount = 100m, string? description = null) =>
        new(Guid.NewGuid(), Guid.NewGuid(), amount, TransactionType.Expense, description, DateTime.UtcNow);

    [Theory]
    [InlineData("0", false)]
    [InlineData("-1", false)]
    [InlineData("0.0001", true)]
    [InlineData("0.00001", false)]
    [InlineData("1", true)]
    [InlineData("999999999999999", true)]
    [InlineData("1000000000000000", false)]
    public void Transaction_AmountRange(string amount, bool valid) =>
        Assert.Equal(valid, IsValid(Tx(decimal.Parse(amount, CultureInfo.InvariantCulture))));

    [Fact] public void Transaction_Description500_Passes() => Assert.True(IsValid(Tx(description: Text(500))));
    [Fact] public void Transaction_Description501_Fails() => Assert.False(IsValid(Tx(description: Text(501))));
    [Fact] public void Transaction_NullDescription_Passes() => Assert.True(IsValid(Tx(description: null)));

    [Fact] public void SuggestCategory_Valid_Passes() => Assert.True(IsValid(new SuggestCategoryRequest("coffee")));
    [Fact] public void SuggestCategory_Empty_Fails() => Assert.False(IsValid(new SuggestCategoryRequest("")));
    [Fact] public void SuggestCategory_501_Fails() => Assert.False(IsValid(new SuggestCategoryRequest(Text(501))));

    // ---- Budgets ----

    private static UpsertBudgetRequest Budget(decimal amount = 100m, byte threshold = 80) =>
        new(Guid.NewGuid(), amount, new DateOnly(2025, 1, 1), new DateOnly(2025, 1, 31), threshold);

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(80, true)]
    [InlineData(100, true)]
    [InlineData(101, false)]
    [InlineData(255, false)]
    public void Budget_ThresholdMustBeBetween1And100(byte threshold, bool valid) =>
        Assert.Equal(valid, IsValid(Budget(threshold: threshold)));

    [Fact] public void Budget_ZeroAmount_Fails() => Assert.False(IsValid(Budget(amount: 0m)));
    [Fact] public void Budget_NegativeAmount_Fails() => Assert.False(IsValid(Budget(amount: -5m)));
    [Fact] public void Budget_PositiveAmount_Passes() => Assert.True(IsValid(Budget(amount: 5m)));
    [Fact] public void Budget_DefaultThresholdIs80() =>
        Assert.Equal(80, new UpsertBudgetRequest(Guid.Empty, 1m, default, default).AlertThreshold);

    // ---- Goals ----

    [Fact] public void Goal_Valid_Passes() => Assert.True(IsValid(new UpsertGoalRequest("Trip", 1000m, null)));
    [Fact] public void Goal_EmptyName_Fails() => Assert.False(IsValid(new UpsertGoalRequest("", 1000m, null)));
    [Fact] public void Goal_Name150_Passes() => Assert.True(IsValid(new UpsertGoalRequest(Text(150), 1000m, null)));
    [Fact] public void Goal_Name151_Fails() => Assert.False(IsValid(new UpsertGoalRequest(Text(151), 1000m, null)));
    [Fact] public void Goal_ZeroTarget_Fails() => Assert.False(IsValid(new UpsertGoalRequest("Trip", 0m, null)));

    [Theory]
    [InlineData(null, true)]
    [InlineData((byte)0, false)]
    [InlineData((byte)1, true)]
    [InlineData((byte)15, true)]
    [InlineData((byte)31, true)]
    [InlineData((byte)32, false)]
    public void Goal_ReminderDayMustBeBetween1And31(byte? day, bool valid) =>
        Assert.Equal(valid, IsValid(new UpsertGoalRequest("Trip", 1000m, null, day)));

    [Fact] public void Contribution_Positive_Passes() => Assert.True(IsValid(new GoalContributionRequest(10m)));
    [Fact] public void Contribution_Zero_Fails() => Assert.False(IsValid(new GoalContributionRequest(0m)));
    [Fact] public void Contribution_Negative_Fails() => Assert.False(IsValid(new GoalContributionRequest(-10m)));

    // ---- Paging ----

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(1000, true)]
    [InlineData(-1, false)]
    public void Paging_Page(int page, bool valid) => Assert.Equal(valid, IsValid(new PagingQuery { Page = page }));

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(100, true)]
    [InlineData(101, false)]
    public void Paging_PageSize(int size, bool valid) => Assert.Equal(valid, IsValid(new PagingQuery { PageSize = size }));

    [Fact]
    public void Paging_Defaults_Are1And20()
    {
        var query = new PagingQuery();
        Assert.Equal(1, query.Page);
        Assert.Equal(20, query.PageSize);
    }

    // ---- Admin ----

    private static readonly DateTime Now = new(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact] public void Announcement_Valid_Passes() => Assert.True(IsValid(new UpsertAnnouncementRequest("T", "C", Now, null)));
    [Fact] public void Announcement_EmptyTitle_Fails() => Assert.False(IsValid(new UpsertAnnouncementRequest("", "C", Now, null)));
    [Fact] public void Announcement_Title201_Fails() =>
        Assert.False(IsValid(new UpsertAnnouncementRequest(Text(201), "C", Now, null)));
    [Fact] public void Announcement_Title200_Passes() =>
        Assert.True(IsValid(new UpsertAnnouncementRequest(Text(200), "C", Now, null)));
    [Fact] public void Announcement_EmptyContent_Fails() => Assert.False(IsValid(new UpsertAnnouncementRequest("T", "", Now, null)));
    [Fact] public void Announcement_Content4001_Fails() =>
        Assert.False(IsValid(new UpsertAnnouncementRequest("T", Text(4001), Now, null)));
    [Fact] public void Announcement_Content4000_Passes() =>
        Assert.True(IsValid(new UpsertAnnouncementRequest("T", Text(4000), Now, null)));

    [Fact] public void Setting_Valid_Passes() => Assert.True(IsValid(new UpsertSettingRequest("v", "d")));
    [Fact] public void Setting_EmptyValue_Fails() => Assert.False(IsValid(new UpsertSettingRequest("", null)));
    [Fact] public void Setting_Description501_Fails() => Assert.False(IsValid(new UpsertSettingRequest("v", Text(501))));
    [Fact] public void Setting_NullDescription_Passes() => Assert.True(IsValid(new UpsertSettingRequest("v", null)));

    [Fact] public void LockUser_Valid_Passes() => Assert.True(IsValid(new LockUserRequest("spam")));
    [Fact] public void LockUser_EmptyReason_Fails() => Assert.False(IsValid(new LockUserRequest("")));
    [Fact] public void LockUser_Reason500_Passes() => Assert.True(IsValid(new LockUserRequest(Text(500))));
    [Fact] public void LockUser_Reason501_Fails() => Assert.False(IsValid(new LockUserRequest(Text(501))));
}

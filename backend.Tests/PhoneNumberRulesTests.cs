using System.ComponentModel.DataAnnotations;
using backend.Helpers;
using backend.DTOs.Requests;
using Xunit;

namespace backend.Tests;

public class PhoneNumberRulesTests
{
    [Theory]
    [InlineData("0901234567", "0901234567")]
    [InlineData("0901 234 567", "0901234567")]
    [InlineData("+84 901 234 567", "0901234567")]
    [InlineData("84 901 234 567", "0901234567")]
    [InlineData("0084 901 234 567", "0901234567")]
    [InlineData("024 3826 1234", "02438261234")]
    [InlineData("+1 202 555 0123", "+12025550123")]
    [InlineData("", null)]
    [InlineData("091234567", null)]
    [InlineData("0612345678", null)]
    [InlineData("023456789", null)]
    [InlineData("+84123456789", null)]
    [InlineData("090123456a", null)]
    public void NormalizesAcceptedFormatsAndRejectsInvalidFormats(string input, string? expected)
    {
        Assert.Equal(expected, PhoneNumberRules.Normalize(input));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("0901 234 567", true)]
    [InlineData("+84 901 234 567", true)]
    [InlineData("090123456a", false)]
    [InlineData("123", false)]
    public void ProfilePhoneValidationMatchesThePhoneRules(string? phone, bool valid)
    {
        var request = new UpdateProfileRequest("Nguyen Van A", phone);
        var results = new List<ValidationResult>();

        // Same rules as ASP.NET model binding, which reads the attributes from the record's constructor parameters.
        var actual = DtoValidationTests.IsValid(request);

        Assert.Equal(valid, actual);
    }

    [Theory]
    [InlineData("0.0001", true)]
    [InlineData("100000", true)]
    [InlineData("999999999999999", true)]
    [InlineData("0", false)]
    [InlineData("-1", false)]
    public void TransactionAmountValidation(string amountText, bool valid)
    {
        var amount = decimal.Parse(amountText);
        var request = new UpsertTransactionRequest(
            Guid.NewGuid(), Guid.NewGuid(), amount, backend.Models.TransactionType.Expense,
            "Lunch", DateTime.UtcNow);
        var results = new List<ValidationResult>();

        // Same rules as ASP.NET model binding, which reads the attributes from the record's constructor parameters.
        var actual = DtoValidationTests.IsValid(request);

        Assert.Equal(valid, actual);
    }

    [Theory]
    [InlineData(1, 20, true)]
    [InlineData(0, 20, false)]
    [InlineData(1, 101, false)]
    public void PagingValidationRejectsInvalidPages(int page, int pageSize, bool valid)
    {
        var query = new PagingQuery { Page = page, PageSize = pageSize };
        var results = new List<ValidationResult>();

        var actual = Validator.TryValidateObject(query, new ValidationContext(query), results, true);

        Assert.Equal(valid, actual);
    }
}

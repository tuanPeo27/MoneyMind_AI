using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;

namespace backend.Helpers;

/// <summary>
/// Phone number rules shared by validation and storage (the frontend mirrors them in src/lib/phone.ts).
/// Spaces, dots, dashes and parentheses are ignored. Accepted:
/// Vietnamese mobile 0[35789]xxxxxxxx (also +84 / 84 prefix), Vietnamese landline 02xxxxxxxxx,
/// or another country in E.164 form (+ country code, 8-15 digits).
/// </summary>
public static partial class PhoneNumberRules
{
    [GeneratedRegex(@"[\s.\-()]")] private static partial Regex Separators();
    [GeneratedRegex(@"^0[35789]\d{8}$")] private static partial Regex VietnamMobile();
    [GeneratedRegex(@"^02\d{9}$")] private static partial Regex VietnamLandline();
    [GeneratedRegex(@"^\+[1-9]\d{7,14}$")] private static partial Regex International();

    /// <summary>Canonical form to store (Vietnamese numbers as 0xxxxxxxxx, others as +xxxxxxxx), or null when invalid.</summary>
    public static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var compact = Separators().Replace(value.Trim(), string.Empty);
        // +84 / 84 / 0084 followed by the national number without its leading 0.
        if (compact.StartsWith("+84")) compact = "0" + compact[3..];
        else if (compact.StartsWith("0084")) compact = "0" + compact[4..];
        else if (compact.StartsWith("84") && compact.Length == 11) compact = "0" + compact[2..];
        if (VietnamMobile().IsMatch(compact) || VietnamLandline().IsMatch(compact)) return compact;
        return International().IsMatch(compact) && !compact.StartsWith("+84") ? compact : null;
    }
}

/// <summary>Empty is allowed (the number is optional); anything else must pass <see cref="PhoneNumberRules"/>.</summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter | AttributeTargets.Field)]
public sealed class ValidPhoneNumberAttribute : ValidationAttribute
{
    public ValidPhoneNumberAttribute() : base("Số điện thoại không hợp lệ. Ví dụ: 0901 234 567 hoặc +84 901 234 567.") { }

    public override bool IsValid(object? value) =>
        value is null || value is string s && (string.IsNullOrWhiteSpace(s) || PhoneNumberRules.Normalize(s) is not null);
}

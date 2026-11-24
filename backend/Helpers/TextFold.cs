using System.Globalization;
using System.Text;

namespace backend.Helpers;

public static class TextFold
{
    /// <summary>
    /// Lower case, Vietnamese accents removed (đ → d), single spaces: "  Cà phê  Sữa " → "ca phe sua".
    /// Used to compare names and descriptions the way people type them.
    /// </summary>
    public static string Fold(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var decomposed = value.Trim().ToLowerInvariant().Replace('đ', 'd').Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) builder.Append(ch);
        return string.Join(' ', builder.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}

using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface ITransactionCategorizationService
{
    Task<CategorySuggestionResponse> SuggestAsync(Guid userId, SuggestCategoryRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>Records the category the user finally chose for a suggestion.</summary>
    Task ConfirmAsync(Guid userId, Guid logId, ConfirmCategorySuggestionRequest request,
        CancellationToken cancellationToken = default);
}

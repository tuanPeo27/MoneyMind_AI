using backend.DTOs.Requests;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;

namespace backend.Tests;

public class CategoryServiceTests : DbTestBase
{
    private readonly FakeAudit _audit = new();
    private readonly CategoryService _sut;

    public CategoryServiceTests() => _sut = new CategoryService(Db, _audit);

    private static UpsertCategoryRequest Req(string name = "Food", CategoryType type = CategoryType.Expense,
        bool active = true) => new(name, type, "icon", "#fff", active);

    private void MarkInUseByTransaction(Category category)
    {
        var account = AddAccount(name: "Acc" + Guid.NewGuid().ToString("N")[..6]);
        AddTransaction(account, category, 10m, category.Type == CategoryType.Income ? TransactionType.Income : TransactionType.Expense);
    }

    // ---- Create ----

    [Fact]
    public async Task Create_ReturnsUserCategory()
    {
        var result = await _sut.CreateAsync(UserId, Req("Coffee"));
        Assert.Equal("Coffee", result.Name);
        Assert.False(result.IsSystem);
        Assert.True(result.IsActive);
        Assert.Equal("icon", result.Icon);
        Assert.Equal("#fff", result.Color);
    }

    [Fact]
    public async Task Create_TrimsName()
    {
        var result = await _sut.CreateAsync(UserId, Req("  Coffee  "));
        Assert.Equal("Coffee", result.Name);
    }

    [Fact]
    public async Task Create_CanBeCreatedInactive()
    {
        var result = await _sut.CreateAsync(UserId, Req(active: false));
        Assert.False(result.IsActive);
    }

    [Fact]
    public async Task Create_DuplicateOfOwnCategory_ThrowsConflict()
    {
        AddCategory("Food");
        await Assert.ThrowsAsync<ConflictException>(() => _sut.CreateAsync(UserId, Req("Food")));
    }

    [Fact]
    public async Task Create_DuplicateOfSystemCategory_ThrowsConflict()
    {
        AddCategory("Food", system: true);
        await Assert.ThrowsAsync<ConflictException>(() => _sut.CreateAsync(UserId, Req("Food")));
    }

    [Fact]
    public async Task Create_SameNameWithDifferentType_IsAllowed()
    {
        AddCategory("Bonus", CategoryType.Income);
        var result = await _sut.CreateAsync(UserId, Req("Bonus", CategoryType.Expense));
        Assert.Equal(CategoryType.Expense, result.Type);
    }

    [Fact]
    public async Task Create_SameNameAsAnotherUsersCategory_IsAllowed()
    {
        AddCategory("Food", userId: OtherUserId);
        var result = await _sut.CreateAsync(UserId, Req("Food"));
        Assert.Equal("Food", result.Name);
    }

    [Fact]
    public async Task Create_WritesNoAuditEntry()
    {
        await _sut.CreateAsync(UserId, Req());
        Assert.Empty(_audit.Entries);
    }

    // ---- GetForUser ----

    [Fact]
    public async Task GetForUser_IncludesActiveSystemAndOwnCategories()
    {
        AddCategory("Sys", system: true);
        AddCategory("Mine");
        var result = await _sut.GetForUserAsync(UserId);
        Assert.Equal(2, result.Count);
    }

    [Fact]
    public async Task GetForUser_HidesInactiveSystemCategories()
    {
        AddCategory("Sys", system: true, active: false);
        Assert.Empty(await _sut.GetForUserAsync(UserId));
    }

    [Fact]
    public async Task GetForUser_ShowsOwnInactiveCategories()
    {
        AddCategory("Mine", active: false);
        Assert.Single(await _sut.GetForUserAsync(UserId));
    }

    [Fact]
    public async Task GetForUser_HidesOtherUsersCategories()
    {
        AddCategory("Theirs", userId: OtherUserId);
        Assert.Empty(await _sut.GetForUserAsync(UserId));
    }

    [Fact]
    public async Task GetForUser_FiltersByType()
    {
        AddCategory("Food");
        AddCategory("Salary", CategoryType.Income);
        var result = await _sut.GetForUserAsync(UserId, CategoryType.Income);
        Assert.Equal("Salary", Assert.Single(result).Name);
    }

    [Fact]
    public async Task GetForUser_OrdersByTypeThenName()
    {
        AddCategory("Zeta");
        AddCategory("Alpha");
        AddCategory("Wage", CategoryType.Income);
        var result = await _sut.GetForUserAsync(UserId);
        Assert.Equal(["Wage", "Alpha", "Zeta"], result.Select(c => c.Name));
    }

    // ---- GetById ----

    [Fact]
    public async Task GetById_OwnCategory()
    {
        var category = AddCategory("Mine");
        Assert.Equal("Mine", (await _sut.GetByIdAsync(UserId, category.Id)).Name);
    }

    [Fact]
    public async Task GetById_SystemCategory()
    {
        var category = AddCategory("Sys", system: true);
        Assert.True((await _sut.GetByIdAsync(UserId, category.Id)).IsSystem);
    }

    [Fact]
    public async Task GetById_OtherUsersCategory_ThrowsNotFound()
    {
        var category = AddCategory("Theirs", userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(UserId, category.Id));
    }

    [Fact]
    public async Task GetById_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(UserId, Guid.NewGuid()));

    // ---- Update ----

    [Fact]
    public async Task Update_ChangesFields()
    {
        var category = AddCategory("Old");
        var result = await _sut.UpdateAsync(UserId, category.Id, Req("New", active: false));
        Assert.Equal("New", result.Name);
        Assert.False(result.IsActive);
    }

    [Fact]
    public async Task Update_SystemCategory_ThrowsForbidden()
    {
        var category = AddCategory("Sys", system: true);
        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.UpdateAsync(UserId, category.Id, Req("X")));
    }

    [Fact]
    public async Task Update_OtherUsersCategory_ThrowsNotFound()
    {
        var category = AddCategory("Theirs", userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.UpdateAsync(UserId, category.Id, Req("X")));
    }

    [Fact]
    public async Task Update_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.UpdateAsync(UserId, Guid.NewGuid(), Req()));

    [Fact]
    public async Task Update_NameClashingWithAnotherCategory_ThrowsConflict()
    {
        AddCategory("Taken");
        var category = AddCategory("Mine");
        await Assert.ThrowsAsync<ConflictException>(() => _sut.UpdateAsync(UserId, category.Id, Req("Taken")));
    }

    [Fact]
    public async Task Update_KeepingOwnName_IsAllowed()
    {
        var category = AddCategory("Same");
        var result = await _sut.UpdateAsync(UserId, category.Id, Req("Same", active: false));
        Assert.False(result.IsActive);
    }

    [Fact]
    public async Task Update_TypeChangeWhenUnused_IsAllowed()
    {
        var category = AddCategory("Flip");
        var result = await _sut.UpdateAsync(UserId, category.Id, Req("Flip", CategoryType.Income));
        Assert.Equal(CategoryType.Income, result.Type);
    }

    [Fact]
    public async Task Update_TypeChangeWhenUsedByTransaction_ThrowsConflict()
    {
        var category = AddCategory("Flip");
        MarkInUseByTransaction(category);
        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.UpdateAsync(UserId, category.Id, Req("Flip", CategoryType.Income)));
    }

    [Fact]
    public async Task Update_TypeChangeWhenUsedByBudget_ThrowsConflict()
    {
        var category = AddCategory("Flip");
        Db.Budgets.Add(new Budget
        {
            UserId = UserId, CategoryId = category.Id, Amount = 10m, StartDate = new DateOnly(2025, 1, 1),
            EndDate = new DateOnly(2025, 1, 31), AlertThreshold = 80
        });
        Db.SaveChanges();
        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.UpdateAsync(UserId, category.Id, Req("Flip", CategoryType.Income)));
    }

    [Fact]
    public async Task Update_RenameWhenUsed_IsAllowed()
    {
        var category = AddCategory("Old");
        MarkInUseByTransaction(category);
        var result = await _sut.UpdateAsync(UserId, category.Id, Req("New"));
        Assert.Equal("New", result.Name);
    }

    // ---- Delete ----

    [Fact]
    public async Task Delete_UnusedCategory_IsRemoved()
    {
        var category = AddCategory("Gone");
        await _sut.DeleteAsync(UserId, category.Id);
        Assert.Empty(Db.Categories);
    }

    [Fact]
    public async Task Delete_UsedCategory_IsDeactivatedInstead()
    {
        var category = AddCategory("Used");
        MarkInUseByTransaction(category);
        await _sut.DeleteAsync(UserId, category.Id);
        Db.ChangeTracker.Clear();
        Assert.False(Db.Categories.Single(c => c.Id == category.Id).IsActive);
    }

    [Fact]
    public async Task Delete_CategoryReferencedBySuggestionLog_IsDeactivatedInstead()
    {
        var category = AddCategory("Suggested");
        Db.CategorySuggestionLogs.Add(new CategorySuggestionLog
        {
            UserId = UserId, Description = "x", SuggestedCategoryId = category.Id
        });
        Db.SaveChanges();
        await _sut.DeleteAsync(UserId, category.Id);
        Db.ChangeTracker.Clear();
        Assert.False(Db.Categories.Single(c => c.Id == category.Id).IsActive);
    }

    [Fact]
    public async Task Delete_SystemCategory_ThrowsForbidden()
    {
        var category = AddCategory("Sys", system: true);
        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.DeleteAsync(UserId, category.Id));
    }

    [Fact]
    public async Task Delete_OtherUsersCategory_ThrowsNotFound()
    {
        var category = AddCategory("Theirs", userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, category.Id));
    }

    [Fact]
    public async Task Delete_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, Guid.NewGuid()));

    // ---- Admin: system categories ----

    [Fact]
    public async Task GetSystemCategories_ReturnsOnlySystemOnesIncludingInactive()
    {
        AddCategory("Sys1", system: true);
        AddCategory("Sys2", system: true, active: false);
        AddCategory("Mine");
        var result = await _sut.GetSystemCategoriesAsync();
        Assert.Equal(2, result.Count);
        Assert.All(result, c => Assert.True(c.IsSystem));
    }

    [Fact]
    public async Task CreateSystemCategory_IsSystemAndAudited()
    {
        var result = await _sut.CreateSystemCategoryAsync(Req("Rent"));
        Assert.True(result.IsSystem);
        Assert.Null(Db.Categories.Single(c => c.Id == result.Id).UserId);
        var entry = Assert.Single(_audit.Entries);
        Assert.Equal("CreateSystemCategory", entry.Action);
        Assert.Equal(result.Id, entry.TargetId);
    }

    [Fact]
    public async Task CreateSystemCategory_Duplicate_ThrowsConflictWithoutAudit()
    {
        AddCategory("Rent", system: true);
        await Assert.ThrowsAsync<ConflictException>(() => _sut.CreateSystemCategoryAsync(Req("Rent")));
        Assert.Empty(_audit.Entries);
    }

    [Fact]
    public async Task CreateSystemCategory_SameNameAsUserCategory_IsAllowed()
    {
        AddCategory("Rent");
        var result = await _sut.CreateSystemCategoryAsync(Req("Rent"));
        Assert.True(result.IsSystem);
    }

    [Fact]
    public async Task UpdateSystemCategory_ChangesFieldsAndAudits()
    {
        var category = AddCategory("Old", system: true);
        var result = await _sut.UpdateSystemCategoryAsync(category.Id, Req("New"));
        Assert.Equal("New", result.Name);
        Assert.Equal("UpdateSystemCategory", Assert.Single(_audit.Entries).Action);
    }

    [Fact]
    public async Task UpdateSystemCategory_UserCategory_ThrowsNotFound()
    {
        var category = AddCategory("Mine");
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.UpdateSystemCategoryAsync(category.Id, Req("X")));
    }

    [Fact]
    public async Task UpdateSystemCategory_Duplicate_ThrowsConflict()
    {
        AddCategory("Taken", system: true);
        var category = AddCategory("Other", system: true);
        await Assert.ThrowsAsync<ConflictException>(() => _sut.UpdateSystemCategoryAsync(category.Id, Req("Taken")));
    }

    [Fact]
    public async Task UpdateSystemCategory_TypeChangeWhenUsed_ThrowsConflict()
    {
        var category = AddCategory("Used", system: true);
        MarkInUseByTransaction(category);
        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.UpdateSystemCategoryAsync(category.Id, Req("Used", CategoryType.Income)));
    }

    [Fact]
    public async Task DeleteSystemCategory_Unused_IsRemovedAndAudited()
    {
        var category = AddCategory("Gone", system: true);
        await _sut.DeleteSystemCategoryAsync(category.Id);
        Assert.Empty(Db.Categories);
        Assert.Equal("DeleteSystemCategory", Assert.Single(_audit.Entries).Action);
    }

    [Fact]
    public async Task DeleteSystemCategory_Used_IsDeactivated()
    {
        var category = AddCategory("Used", system: true);
        MarkInUseByTransaction(category);
        await _sut.DeleteSystemCategoryAsync(category.Id);
        Db.ChangeTracker.Clear();
        Assert.False(Db.Categories.Single(c => c.Id == category.Id).IsActive);
    }

    [Fact]
    public async Task DeleteSystemCategory_UserCategory_ThrowsNotFound()
    {
        var category = AddCategory("Mine");
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteSystemCategoryAsync(category.Id));
    }

    [Fact]
    public async Task DeleteSystemCategory_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteSystemCategoryAsync(Guid.NewGuid()));
}

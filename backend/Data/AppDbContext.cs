using backend.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace backend.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<Budget> Budgets => Set<Budget>();
    public DbSet<FinancialGoal> FinancialGoals => Set<FinancialGoal>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<AIConversation> AIConversations => Set<AIConversation>();
    public DbSet<AIChatMessage> AIChatMessages => Set<AIChatMessage>();
    public DbSet<AIFeedback> AIFeedbacks => Set<AIFeedback>();
    public DbSet<UserEncryptionKey> UserEncryptionKeys => Set<UserEncryptionKey>();
    public DbSet<AIInsight> AIInsights => Set<AIInsight>();
    public DbSet<AIRecommendation> AIRecommendations => Set<AIRecommendation>();
    public DbSet<ReportSnapshot> ReportSnapshots => Set<ReportSnapshot>();
    public DbSet<UserAISettings> UserAISettings => Set<UserAISettings>();
    public DbSet<CategorySuggestionLog> CategorySuggestionLogs => Set<CategorySuggestionLog>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<AIProcessingLog> AIProcessingLogs => Set<AIProcessingLog>();
    public DbSet<ServiceHealthCheck> ServiceHealthChecks => Set<ServiceHealthCheck>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<SystemAnnouncement> SystemAnnouncements => Set<SystemAnnouncement>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<ApplicationUser>(entity =>
        {
            entity.ToTable("Users");
            entity.Property(user => user.FullName).HasMaxLength(100).IsRequired();
            entity.Property(user => user.Email).HasMaxLength(256).IsRequired();
            entity.Property(user => user.AvatarUrl).HasMaxLength(2048);
            entity.Property(user => user.TimeZoneId).HasMaxLength(100).HasDefaultValue("Asia/Ho_Chi_Minh").IsRequired();
            entity.Property(user => user.LockedReason).HasMaxLength(500);
            entity.HasIndex(user => user.Email).IsUnique();
        });

        builder.Entity<IdentityRole<Guid>>().ToTable("Roles");
        builder.Entity<IdentityUserRole<Guid>>().ToTable("UserRoles");
        builder.Entity<IdentityUserClaim<Guid>>().ToTable("UserClaims");
        builder.Entity<IdentityUserLogin<Guid>>().ToTable("UserLogins");
        builder.Entity<IdentityRoleClaim<Guid>>().ToTable("RoleClaims");
        builder.Entity<IdentityUserToken<Guid>>().ToTable("UserTokens");

        builder.Entity<Account>(entity =>
        {
            entity.Property(account => account.Name).HasMaxLength(100).IsRequired();
            entity.Property(account => account.AccountType).HasConversion<byte>();
            entity.Property(account => account.InitialBalance).HasColumnType("decimal(19,4)");
            entity.Property(account => account.Currency).HasColumnType("char(3)").HasMaxLength(3).IsRequired();
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(account => account.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Category>(entity =>
        {
            entity.Property(category => category.Name).HasMaxLength(100).IsRequired();
            entity.Property(category => category.Type).HasConversion<byte>();
            entity.Property(category => category.Icon).HasMaxLength(50);
            entity.Property(category => category.Color).HasMaxLength(50);
            entity.HasIndex(category => new { category.UserId, category.Type });
            entity.HasIndex(category => category.IsSystem);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(category => category.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Transaction>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Transactions_Amount_Positive",
                "[Amount] > 0"));
            entity.Property(transaction => transaction.Amount).HasColumnType("decimal(19,4)");
            entity.Property(transaction => transaction.Type).HasConversion<byte>();
            entity.Property(transaction => transaction.Source).HasConversion<byte>();
            entity.Property(transaction => transaction.Description).HasMaxLength(500);
            entity.HasIndex(transaction => new { transaction.UserId, transaction.TransactionDate });
            entity.HasIndex(transaction => new
            {
                transaction.UserId,
                transaction.CategoryId,
                transaction.TransactionDate
            });
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(transaction => transaction.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Account>().WithMany().HasForeignKey(transaction => transaction.AccountId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Category>().WithMany().HasForeignKey(transaction => transaction.CategoryId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        builder.Entity<Budget>(entity =>
        {
            entity.Property(budget => budget.Amount).HasColumnType("decimal(19,4)");
            entity.HasIndex(budget => new { budget.UserId, budget.StartDate, budget.EndDate });
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(budget => budget.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Category>().WithMany().HasForeignKey(budget => budget.CategoryId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        builder.Entity<FinancialGoal>(entity =>
        {
            entity.Property(goal => goal.Name).HasMaxLength(150).IsRequired();
            entity.Property(goal => goal.TargetAmount).HasColumnType("decimal(19,4)");
            entity.Property(goal => goal.CurrentAmount).HasColumnType("decimal(19,4)");
            entity.Property(goal => goal.Status).HasConversion<byte>();
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(goal => goal.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Notification>(entity =>
        {
            entity.Property(notification => notification.Type).HasConversion<byte>();
            entity.Property(notification => notification.Source).HasConversion<byte>();
            entity.Property(notification => notification.Title).HasMaxLength(200).IsRequired();
            entity.Property(notification => notification.Message).HasMaxLength(2000).IsRequired();
            entity.Property(notification => notification.RelatedType).HasMaxLength(50);
            entity.HasIndex(notification => new
            {
                notification.UserId,
                notification.IsRead,
                notification.CreatedAt
            });
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(notification => notification.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AIConversation>(entity =>
        {
            entity.Property(conversation => conversation.TitleCipher).IsRequired();
            entity.Property(conversation => conversation.TitleNonce).HasColumnType("varbinary(12)").IsRequired();
            entity.HasIndex(conversation => new { conversation.UserId, conversation.UpdatedAt })
                .HasFilter("[DeletedAt] IS NULL");
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(conversation => conversation.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AIChatMessage>(entity =>
        {
            entity.Property(message => message.Role).HasConversion<byte>();
            entity.Property(message => message.ContentCipher).HasColumnType("varbinary(max)").IsRequired();
            entity.Property(message => message.Nonce).HasColumnType("binary(12)").IsRequired();
            entity.Property(message => message.Intent).HasMaxLength(50);
            entity.Property(message => message.Metadata).HasColumnType("nvarchar(max)");
            entity.Property(message => message.Status).HasConversion<byte>();
            entity.HasIndex(message => new { message.ConversationId, message.Sequence }).IsUnique();
            entity.HasOne<AIConversation>().WithMany().HasForeignKey(message => message.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AIFeedback>(entity =>
        {
            entity.Property(feedback => feedback.Rating).HasMaxLength(20).IsRequired();
            entity.Property(feedback => feedback.FeedbackText).HasMaxLength(2000);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(feedback => feedback.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<AIChatMessage>().WithMany().HasForeignKey(feedback => feedback.MessageId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        builder.Entity<UserEncryptionKey>(entity =>
        {
            entity.Property(key => key.WrappedDek).HasColumnType("varbinary(max)").IsRequired();
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(key => key.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AIInsight>(entity =>
        {
            entity.Property(insight => insight.InsightType).HasMaxLength(50).IsRequired();
            entity.Property(insight => insight.Title).HasMaxLength(200).IsRequired();
            entity.Property(insight => insight.Content).HasMaxLength(4000).IsRequired();
            entity.Property(insight => insight.Severity).HasConversion<byte>();
            entity.Property(insight => insight.DataJson).HasColumnType("nvarchar(max)");
            entity.HasIndex(insight => new { insight.UserId, insight.IsRead, insight.CreatedAt });
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(insight => insight.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AIRecommendation>(entity =>
        {
            entity.Property(recommendation => recommendation.RecommendationType).HasMaxLength(50).IsRequired();
            entity.Property(recommendation => recommendation.Title).HasMaxLength(200).IsRequired();
            entity.Property(recommendation => recommendation.Description).HasMaxLength(4000).IsRequired();
            entity.Property(recommendation => recommendation.DataJson).HasColumnType("nvarchar(max)");
            entity.Property(recommendation => recommendation.Status).HasConversion<byte>();
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(recommendation => recommendation.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ReportSnapshot>(entity =>
        {
            entity.Property(snapshot => snapshot.PeriodType).HasConversion<byte>();
            entity.Property(snapshot => snapshot.DataJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(snapshot => snapshot.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<UserAISettings>(entity =>
        {
            entity.HasKey(settings => settings.UserId);
            entity.Property(settings => settings.ReportFrequency).HasMaxLength(30).IsRequired();
            entity.HasOne<ApplicationUser>().WithOne().HasForeignKey<UserAISettings>(settings => settings.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<CategorySuggestionLog>(entity =>
        {
            entity.Property(log => log.Description).HasMaxLength(500).IsRequired();
            entity.Property(log => log.Confidence).HasColumnType("decimal(5,4)");
            entity.Property(log => log.Reason).HasMaxLength(1000);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(log => log.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Transaction>().WithMany().HasForeignKey(log => log.TransactionId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Category>().WithMany().HasForeignKey(log => log.SuggestedCategoryId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Category>().WithMany().HasForeignKey(log => log.FinalCategoryId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        builder.Entity<AuditLog>(entity =>
        {
            entity.Property(log => log.Action).HasMaxLength(100).IsRequired();
            entity.Property(log => log.TargetType).HasMaxLength(100).IsRequired();
            entity.Property(log => log.Detail).HasMaxLength(2000);
            entity.Property(log => log.IpAddress).HasMaxLength(45);
            entity.HasIndex(log => new { log.AdminId, log.CreatedAt });
            entity.HasIndex(log => new { log.TargetType, log.TargetId });
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(log => log.AdminId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        builder.Entity<AIProcessingLog>(entity =>
        {
            entity.Property(log => log.TaskType).HasMaxLength(100).IsRequired();
            entity.Property(log => log.Provider).HasMaxLength(100);
            entity.Property(log => log.Status).HasConversion<byte>();
            entity.Property(log => log.ErrorCode).HasMaxLength(100);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(log => log.UserId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        builder.Entity<ServiceHealthCheck>(entity =>
        {
            entity.Property(check => check.ServiceName).HasMaxLength(100).IsRequired();
            entity.Property(check => check.Status).HasMaxLength(50).IsRequired();
            entity.Property(check => check.Message).HasMaxLength(1000);
        });

        builder.Entity<SystemSetting>(entity =>
        {
            entity.HasKey(setting => setting.Key);
            entity.Property(setting => setting.Key).HasMaxLength(100);
            entity.Property(setting => setting.Value).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(setting => setting.Description).HasMaxLength(500);
            entity.Property(setting => setting.UpdatedBy).HasMaxLength(256);
        });

        builder.Entity<SystemAnnouncement>(entity =>
        {
            entity.Property(announcement => announcement.Title).HasMaxLength(200).IsRequired();
            entity.Property(announcement => announcement.Content).HasMaxLength(4000).IsRequired();
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(announcement => announcement.AdminId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        builder.Entity<RefreshToken>(entity =>
        {
            entity.Property(token => token.TokenHash).HasMaxLength(500).IsRequired();
            entity.Property(token => token.DeviceInfo).HasMaxLength(500);
            entity.Property(token => token.IpAddress).HasMaxLength(45);
            entity.HasIndex(token => token.TokenHash).IsUnique();
            entity.HasIndex(token => token.UserId);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(token => token.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<PasswordResetToken>(entity =>
        {
            entity.Property(token => token.TokenHash).HasMaxLength(500).IsRequired();
            entity.HasIndex(token => token.TokenHash).IsUnique();
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(token => token.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
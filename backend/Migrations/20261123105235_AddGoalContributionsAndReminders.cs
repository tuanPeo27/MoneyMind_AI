using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddGoalContributionsAndReminders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "LastReminderOn",
                table: "FinancialGoals",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<byte>(
                name: "ReminderDay",
                table: "FinancialGoals",
                type: "tinyint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "GoalContributions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GoalId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Amount = table.Column<decimal>(type: "decimal(19,4)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoalContributions", x => x.Id);
                    table.CheckConstraint("CK_GoalContributions_Amount_Positive", "[Amount] > 0");
                    table.ForeignKey(
                        name: "FK_GoalContributions_Accounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_GoalContributions_FinancialGoals_GoalId",
                        column: x => x.GoalId,
                        principalTable: "FinancialGoals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinancialGoals_ReminderDay",
                table: "FinancialGoals",
                sql: "[ReminderDay] IS NULL OR ([ReminderDay] >= 1 AND [ReminderDay] <= 31)");

            migrationBuilder.CreateIndex(
                name: "IX_GoalContributions_AccountId",
                table: "GoalContributions",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_GoalContributions_GoalId",
                table: "GoalContributions",
                column: "GoalId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GoalContributions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FinancialGoals_ReminderDay",
                table: "FinancialGoals");

            migrationBuilder.DropColumn(
                name: "LastReminderOn",
                table: "FinancialGoals");

            migrationBuilder.DropColumn(
                name: "ReminderDay",
                table: "FinancialGoals");
        }
    }
}

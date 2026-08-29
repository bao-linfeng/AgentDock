-- AlterTable: approvals — T8.3 Approval Model (docs/tasks.md T8.3, #37)
-- `action`/`status` become enums matching @agentdock/protocol's
-- ApprovalActionSchema / ApprovalStatusSchema; add `summary` / `detailJson`
-- (redacted request detail) / `resolvedBy` (free-form identity, no users
-- table in MVP) and an index on `status` for the pending-approvals list.
ALTER TABLE `approvals`
    MODIFY `action` ENUM('shell', 'push', 'destructive') NOT NULL,
    MODIFY `status` ENUM('pending', 'approved', 'denied') NOT NULL DEFAULT 'pending',
    ADD COLUMN `summary` TEXT NULL,
    ADD COLUMN `detailJson` JSON NULL,
    ADD COLUMN `resolvedBy` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `approvals_status_idx` ON `approvals`(`status`);

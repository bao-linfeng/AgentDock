-- CreateTable: audit_logs — T9.5 unified audit trail (docs/tasks.md T9.5, #63)
-- requirements.md §10 requires actor / source / prompt / runner / executor /
-- status / artifact to be auditable. Structured detail lives in `detailJson`
-- (redacted before storage); `projectId` / `taskId` / `runId` are plain columns
-- rather than foreign keys so entries outlive the rows they describe.
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM(
        'task_created',
        'task_cancelled',
        'run_claimed',
        'run_completed',
        'run_retried',
        'approval_requested',
        'approval_resolved',
        'runner_registered',
        'runner_revoked'
    ) NOT NULL,
    `source` ENUM('web', 'github', 'runner', 'system') NOT NULL,
    `actor` VARCHAR(191) NULL,
    `projectId` VARCHAR(191) NULL,
    `taskId` VARCHAR(191) NULL,
    `runId` VARCHAR(191) NULL,
    `detailJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_taskId_idx`(`taskId`),
    INDEX `audit_logs_runId_idx`(`runId`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

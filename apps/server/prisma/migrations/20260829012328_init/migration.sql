-- CreateTable
CREATE TABLE `projects` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `workspaceKey` VARCHAR(191) NOT NULL,
    `defaultBranch` VARCHAR(191) NOT NULL DEFAULT 'main',
    `testCommand` VARCHAR(191) NULL,
    `buildCommand` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `projects_workspaceKey_key`(`workspaceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `repositories` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'github',
    `owner` VARCHAR(191) NOT NULL,
    `repo` VARCHAR(191) NOT NULL,
    `installationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `repositories_projectId_idx`(`projectId`),
    UNIQUE INDEX `repositories_provider_owner_repo_key`(`provider`, `owner`, `repo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `runners` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `machineName` VARCHAR(191) NULL,
    `platform` VARCHAR(191) NULL,
    `version` VARCHAR(191) NULL,
    `status` ENUM('online', 'offline') NOT NULL DEFAULT 'offline',
    `tokenHash` VARCHAR(191) NOT NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `revokedAt` DATETIME(3) NULL,
    `lastHeartbeatAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `runners_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `runner_projects` (
    `runnerId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `workspacePath` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`runnerId`, `projectId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `source` ENUM('web', 'github') NOT NULL,
    `sourceRef` VARCHAR(191) NULL,
    `deliveryId` VARCHAR(191) NULL,
    `intent` ENUM('fix', 'implement', 'review', 'test', 'general') NOT NULL,
    `prompt` TEXT NOT NULL,
    `status` ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tasks_sourceRef_key`(`sourceRef`),
    UNIQUE INDEX `tasks_deliveryId_key`(`deliveryId`),
    INDEX `tasks_projectId_idx`(`projectId`),
    INDEX `tasks_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_runs` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `runnerId` VARCHAR(191) NULL,
    `executor` VARCHAR(191) NOT NULL DEFAULT 'opencode',
    `status` ENUM('queued', 'assigned', 'running', 'needs_approval', 'verifying', 'publishing', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
    `branch` VARCHAR(191) NULL,
    `worktreePath` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `cancelRequestedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `task_runs_taskId_idx`(`taskId`),
    INDEX `task_runs_runnerId_idx`(`runnerId`),
    INDEX `task_runs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `run_events` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `payloadJson` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `run_events_runId_idx`(`runId`),
    UNIQUE INDEX `run_events_runId_seq_key`(`runId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `artifacts` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `uri` VARCHAR(191) NULL,
    `metadataJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `artifacts_runId_idx`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approvals` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `approvals_runId_idx`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `repositories` ADD CONSTRAINT `repositories_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `runner_projects` ADD CONSTRAINT `runner_projects_runnerId_fkey` FOREIGN KEY (`runnerId`) REFERENCES `runners`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `runner_projects` ADD CONSTRAINT `runner_projects_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_runs` ADD CONSTRAINT `task_runs_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_runs` ADD CONSTRAINT `task_runs_runnerId_fkey` FOREIGN KEY (`runnerId`) REFERENCES `runners`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `run_events` ADD CONSTRAINT `run_events_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `task_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `artifacts` ADD CONSTRAINT `artifacts_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `task_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approvals` ADD CONSTRAINT `approvals_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `task_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `callbackIsPullRequest` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `callbackIssueNumber` INTEGER NULL,
    ADD COLUMN `callbackRepo` VARCHAR(191) NULL;

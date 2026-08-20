-- SPACE-02：会话空间上下文
--
-- 只加一列：会话的当前经营空间。可空且不回填成具体值——
-- 当前空间由**登录时**按成员关系解析，历史会话让它保持 NULL 即可：
-- 那些会话下一次访问经营接口会被 fail-closed 拒绝，重新登录后即获得空间。
-- 刻意不猜测历史会话该属于哪个空间。
--
-- 跨租户防护不依赖这里的外键：`workspace_members` 的复合外键已保证
-- 「账号在该空间有成员关系」蕴含两者同租户，切换接口据此校验。
-- ON DELETE SET NULL：空间被删时会话退化为"无当前空间"，而不是连带删掉登录态。

-- AlterTable
ALTER TABLE `auth_sessions` ADD COLUMN `currentWorkspaceId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `auth_sessions_workspace_idx` ON `auth_sessions`(`currentWorkspaceId`);

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_currentWorkspaceId_fkey` FOREIGN KEY (`currentWorkspaceId`) REFERENCES `business_workspaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

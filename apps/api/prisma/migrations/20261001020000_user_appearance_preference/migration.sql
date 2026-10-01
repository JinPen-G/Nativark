-- 账户级外观偏好：跟随登录账户、与租户品牌色（tenant_appearance_profiles.themeColor）相互独立。
-- 目前仅存管理后台主题色（#RRGGBB，可空=回退平台默认色）。一账户一条（userId 唯一），随账号删除级联清理。
CREATE TABLE `user_appearance_preferences` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `themeColor` VARCHAR(16) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `user_appearance_preferences_user_key`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_appearance_preferences` ADD CONSTRAINT `user_appearance_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

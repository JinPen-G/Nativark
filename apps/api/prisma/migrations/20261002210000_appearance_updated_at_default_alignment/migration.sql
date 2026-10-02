-- Match the existing Prisma @updatedAt definitions. Prisma supplies updatedAt on
-- inserts/updates; removing these SQL defaults does not rewrite existing rows.
-- Forward-only correction: preserve the already-applied table creation migrations.
ALTER TABLE `tenant_appearance_profiles` ALTER COLUMN `updatedAt` DROP DEFAULT;
ALTER TABLE `user_appearance_preferences` ALTER COLUMN `updatedAt` DROP DEFAULT;

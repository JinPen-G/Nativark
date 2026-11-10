-- DropForeignKey
ALTER TABLE `business_workspaces` DROP FOREIGN KEY `business_workspaces_categoryCode_fkey`;

-- DropForeignKey
ALTER TABLE `business_workspaces` DROP FOREIGN KEY `business_workspaces_categoryCode_categoryVersionId_fkey`;

-- DropForeignKey
ALTER TABLE `rental_category_definitions` DROP FOREIGN KEY `rental_category_definitions_code_recommendedVersionId_fkey`;

-- DropForeignKey
ALTER TABLE `rental_category_versions` DROP FOREIGN KEY `rental_category_versions_categoryCode_fkey`;

-- DropForeignKey
ALTER TABLE `rental_category_governance_audits` DROP FOREIGN KEY `rental_category_governance_audits_categoryCode_fkey`;

-- DropForeignKey
ALTER TABLE `tenant_rental_profiles` DROP FOREIGN KEY `tenant_rental_profiles_categoryCode_fkey`;

-- DropForeignKey
ALTER TABLE `rental_item_groups` DROP FOREIGN KEY `rental_item_groups_categoryCode_fkey`;

-- DropForeignKey
ALTER TABLE `rental_pricing_groups` DROP FOREIGN KEY `rental_pricing_groups_categoryCode_fkey`;

-- DropForeignKey
ALTER TABLE `rental_orders` DROP FOREIGN KEY `rental_orders_categoryCode_categoryVersionId_fkey`;

-- DropForeignKey
ALTER TABLE `rental_inspection_templates` DROP FOREIGN KEY `rental_inspection_templates_categoryCode_fkey`;

-- DropForeignKey
ALTER TABLE `rental_quotes` DROP FOREIGN KEY `rental_quotes_categoryCode_categoryVersionId_fkey`;

-- AlterTable
ALTER TABLE `business_workspaces` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_category_definitions` DROP PRIMARY KEY,
    MODIFY `code` VARCHAR(64) NOT NULL,
    ADD PRIMARY KEY (`code`);

-- AlterTable
ALTER TABLE `rental_category_versions` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_category_governance_audits` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `tenant_rental_profiles` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_item_groups` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_pricing_groups` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_orders` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_inspection_templates` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_tenant_business_settings` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_pricing_plans` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_discount_plans` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_value_added_services` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_rule_versions` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `rental_quotes` MODIFY `categoryCode` VARCHAR(64) NOT NULL;

-- AddForeignKey
ALTER TABLE `business_workspaces` ADD CONSTRAINT `business_workspaces_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_workspaces` ADD CONSTRAINT `business_workspaces_categoryCode_categoryVersionId_fkey` FOREIGN KEY (`categoryCode`, `categoryVersionId`) REFERENCES `rental_category_versions`(`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_definitions` ADD CONSTRAINT `rental_category_definitions_code_recommendedVersionId_fkey` FOREIGN KEY (`code`, `recommendedVersionId`) REFERENCES `rental_category_versions`(`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_versions` ADD CONSTRAINT `rental_category_versions_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_governance_audits` ADD CONSTRAINT `rental_category_governance_audits_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_rental_profiles` ADD CONSTRAINT `tenant_rental_profiles_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_item_groups` ADD CONSTRAINT `rental_item_groups_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_groups` ADD CONSTRAINT `rental_pricing_groups_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_orders` ADD CONSTRAINT `rental_orders_categoryCode_categoryVersionId_fkey` FOREIGN KEY (`categoryCode`, `categoryVersionId`) REFERENCES `rental_category_versions`(`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_orders` ADD CONSTRAINT `rental_orders_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_inspection_templates` ADD CONSTRAINT `rental_inspection_templates_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_tenant_business_settings` ADD CONSTRAINT `rental_tenant_business_settings_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_plans` ADD CONSTRAINT `rental_pricing_plans_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_discount_plans` ADD CONSTRAINT `rental_discount_plans_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_value_added_services` ADD CONSTRAINT `rental_value_added_services_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_rule_versions` ADD CONSTRAINT `rental_rule_versions_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_quotes` ADD CONSTRAINT `rental_quotes_categoryCode_categoryVersionId_fkey` FOREIGN KEY (`categoryCode`, `categoryVersionId`) REFERENCES `rental_category_versions`(`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_quotes` ADD CONSTRAINT `rental_quotes_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

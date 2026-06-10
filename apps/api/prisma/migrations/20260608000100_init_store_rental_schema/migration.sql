-- CreateTable
CREATE TABLE `Tenant` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'frozen', 'disabled') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tenant_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrganizationUnit` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `type` ENUM('operator', 'car_shop', 'store', 'station') NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `OrganizationUnit_tenantId_type_idx`(`tenantId`, `type`),
    UNIQUE INDEX `OrganizationUnit_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `roleId` VARCHAR(191) NULL,
    `account` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `isPlatformAdmin` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `User_tenantId_organizationId_idx`(`tenantId`, `organizationId`),
    UNIQUE INDEX `User_tenantId_account_key`(`tenantId`, `account`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `scope` ENUM('operator', 'car_shop', 'store', 'station') NOT NULL,
    `fixedAllPermissions` BOOLEAN NOT NULL DEFAULT false,
    `enabledBusinessScopes` JSON NOT NULL,
    `buttonPermissions` JSON NULL,
    `dataScope` ENUM('all', 'organization', 'store', 'own') NOT NULL DEFAULT 'store',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_tenantId_code_key`(`tenantId`, `code`),
    UNIQUE INDEX `Role_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `module` VARCHAR(191) NOT NULL,
    `kind` ENUM('menu', 'action', 'button') NOT NULL DEFAULT 'action',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Permission_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserRole` (
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserRole_roleId_idx`(`roleId`),
    PRIMARY KEY (`userId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreStation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `parentStoreName` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'store_counter',
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `serviceStatus` VARCHAR(191) NOT NULL DEFAULT 'normal',
    `address` VARCHAR(191) NULL,
    `serviceTypes` JSON NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StoreStation_tenantId_parentStoreName_status_idx`(`tenantId`, `parentStoreName`, `status`),
    UNIQUE INDEX `StoreStation_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleGroup` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `seats` INTEGER NOT NULL,
    `brand` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `energyType` VARCHAR(191) NULL,
    `transmission` VARCHAR(191) NULL,
    `luggageCount` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `VehicleGroup_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vehicle` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NULL,
    `currentStationId` VARCHAR(191) NULL,
    `vehicleGroupId` VARCHAR(191) NOT NULL,
    `plateNo` VARCHAR(191) NOT NULL,
    `vin` VARCHAR(191) NULL,
    `assetCompanyName` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL,
    `cid` VARCHAR(191) NULL,
    `isSpecial` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `operationStatus` ENUM('idle', 'reserved', 'renting', 'controlled', 'maintenance', 'disabled') NOT NULL DEFAULT 'idle',
    `currentServiceType` ENUM('STORE_STANDARD', 'STORE_24H') NOT NULL DEFAULT 'STORE_STANDARD',
    `serviceTypes` JSON NOT NULL,
    `mileage` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Vehicle_tenantId_storeId_status_idx`(`tenantId`, `storeId`, `status`),
    INDEX `Vehicle_tenantId_currentStationId_operationStatus_idx`(`tenantId`, `currentStationId`, `operationStatus`),
    UNIQUE INDEX `Vehicle_tenantId_plateNo_key`(`tenantId`, `plateNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleLocationEvent` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `storeName` VARCHAR(191) NOT NULL,
    `stationName` VARCHAR(191) NOT NULL,
    `mileage` INTEGER NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `operator` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VehicleLocationEvent_vehicleId_occurredAt_idx`(`vehicleId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleConditionPhotoRecord` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `scene` VARCHAR(191) NOT NULL,
    `remark` VARCHAR(191) NOT NULL,
    `photos` JSON NOT NULL,
    `operator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VehicleConditionPhotoRecord_vehicleId_createdAt_idx`(`vehicleId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleMaintenanceRecord` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NOT NULL,
    `mileage` INTEGER NOT NULL,
    `costAmount` DECIMAL(12, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `remark` VARCHAR(191) NULL,
    `operator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VehicleMaintenanceRecord_vehicleId_status_idx`(`vehicleId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleAccidentRecord` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `claimStatus` VARCHAR(191) NOT NULL,
    `estimatedCostAmount` DECIMAL(12, 2) NOT NULL,
    `reportNo` VARCHAR(191) NULL,
    `operator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VehicleAccidentRecord_vehicleId_claimStatus_idx`(`vehicleId`, `claimStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipPlan` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('draft', 'effective', 'archived') NOT NULL DEFAULT 'draft',
    `levelRules` JSON NOT NULL,
    `benefits` JSON NOT NULL,
    `effectiveAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MembershipPlan_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `MembershipPlan_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Member` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `phoneMasked` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL,
    `levelName` VARCHAR(191) NOT NULL,
    `status` ENUM('pending_review', 'active', 'suspended', 'blacklisted') NOT NULL DEFAULT 'pending_review',
    `reviewStatus` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `tags` JSON NOT NULL,
    `pointsBalance` INTEGER NOT NULL DEFAULT 0,
    `totalOrders` INTEGER NOT NULL DEFAULT 0,
    `totalSpendAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `identityVerified` BOOLEAN NOT NULL DEFAULT false,
    `driverLicenseVerified` BOOLEAN NOT NULL DEFAULT false,
    `identityNoMasked` VARCHAR(191) NULL,
    `driverLicenseNoMasked` VARCHAR(191) NULL,
    `birthday` DATETIME(3) NULL,
    `emergencyContactName` VARCHAR(191) NULL,
    `emergencyContactPhone` VARCHAR(191) NULL,
    `riskNote` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `lastOrderAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Member_tenantId_status_reviewStatus_idx`(`tenantId`, `status`, `reviewStatus`),
    UNIQUE INDEX `Member_tenantId_phone_key`(`tenantId`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberRiskEvent` (
    `id` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `operator` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MemberRiskEvent_memberId_createdAt_idx`(`memberId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberTimelineEvent` (
    `id` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MemberTimelineEvent_memberId_createdAt_idx`(`memberId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Corporate` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `shortName` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'paused', 'disabled') NOT NULL DEFAULT 'active',
    `creditLimitAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `creditWarningAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `accountPeriodDays` INTEGER NOT NULL DEFAULT 30,
    `billingCycleDay` INTEGER NOT NULL DEFAULT 25,
    `settlementMode` ENUM('monthly', 'prepaid') NOT NULL DEFAULT 'monthly',
    `contactName` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `billingEmail` VARCHAR(191) NULL,
    `statementEmail` VARCHAR(191) NULL,
    `reconciliationContactName` VARCHAR(191) NULL,
    `reconciliationContactPhone` VARCHAR(191) NULL,
    `autoGenerateStatement` BOOLEAN NOT NULL DEFAULT true,
    `invoiceTitle` VARCHAR(191) NULL,
    `linkedStores` JSON NOT NULL,
    `notes` VARCHAR(191) NULL,
    `activeOrderCount` INTEGER NOT NULL DEFAULT 0,
    `lastOrderAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Corporate_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `Corporate_tenantId_shortName_key`(`tenantId`, `shortName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorporateContact` (
    `id` VARCHAR(191) NOT NULL,
    `corporateId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CorporateContact_corporateId_idx`(`corporateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorporateContract` (
    `id` VARCHAR(191) NOT NULL,
    `corporateId` VARCHAR(191) NOT NULL,
    `contractNo` VARCHAR(191) NOT NULL,
    `contractName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `linkedStores` JSON NOT NULL,
    `statementEmail` VARCHAR(191) NULL,
    `attachments` JSON NOT NULL,
    `remark` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CorporateContract_corporateId_contractNo_key`(`corporateId`, `contractNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorporateMonthlyBill` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `corporateId` VARCHAR(191) NOT NULL,
    `billNo` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `status` ENUM('draft', 'posted', 'partially_paid', 'paid', 'void') NOT NULL DEFAULT 'draft',
    `orderCount` INTEGER NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `paidAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `balanceAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `dueDate` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CorporateMonthlyBill_corporateId_period_idx`(`corporateId`, `period`),
    UNIQUE INDEX `CorporateMonthlyBill_tenantId_billNo_key`(`tenantId`, `billNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorporateMonthlyBillLine` (
    `id` VARCHAR(191) NOT NULL,
    `billId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `vehicleGroupName` VARCHAR(191) NOT NULL,
    `pickupStoreName` VARCHAR(191) NOT NULL,
    `returnStoreName` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `remark` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CorporateMonthlyBillLine_billId_idx`(`billId`),
    INDEX `CorporateMonthlyBillLine_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorporateMonthlyBillSettlement` (
    `id` VARCHAR(191) NOT NULL,
    `billId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `operator` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CorporateMonthlyBillSettlement_billId_createdAt_idx`(`billId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreRentalOrder` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `mode` ENUM('store_rental', 'self_service_24h') NOT NULL,
    `mainStatus` ENUM('pending_payment', 'reserved', 'pickup_overdue', 'inspecting', 'renting', 'renewing', 'overdue', 'accident_processing', 'settlement_pending', 'payment_due', 'refund_pending', 'completed', 'cancelled', 'no_show', 'rejected', 'closed') NOT NULL,
    `dispatchStatus` ENUM('pending', 'pre_assigned', 'locked', 'manual_reassigned', 'upgraded', 'dispatch_manual_required') NOT NULL,
    `paymentStatus` ENUM('unpaid', 'deposit_paid', 'monthly_billing', 'partial_paid', 'paid', 'payment_due', 'refund_pending', 'refunded') NOT NULL,
    `billingMode` ENUM('customer_pay', 'monthly') NOT NULL,
    `memberId` VARCHAR(191) NULL,
    `corporateId` VARCHAR(191) NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerPhoneMasked` VARCHAR(191) NOT NULL,
    `corporateShortName` VARCHAR(191) NULL,
    `vehicleGroupId` VARCHAR(191) NOT NULL,
    `vehicleGroupSnapshot` JSON NOT NULL,
    `assignedVehicleId` VARCHAR(191) NULL,
    `assignedVehicleSnapshot` JSON NULL,
    `pickupStationId` VARCHAR(191) NULL,
    `returnStationId` VARCHAR(191) NULL,
    `pickupStoreSnapshot` JSON NOT NULL,
    `returnStoreSnapshot` JSON NOT NULL,
    `pickupAt` DATETIME(3) NOT NULL,
    `returnAt` DATETIME(3) NOT NULL,
    `totalAmount` DECIMAL(12, 2) NOT NULL,
    `riskFlags` JSON NOT NULL,
    `pricingSnapshot` JSON NOT NULL,
    `marketingSnapshot` JSON NULL,
    `termsSnapshot` JSON NOT NULL,
    `settlementSummary` JSON NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StoreRentalOrder_tenantId_mainStatus_pickupAt_idx`(`tenantId`, `mainStatus`, `pickupAt`),
    INDEX `StoreRentalOrder_tenantId_memberId_idx`(`tenantId`, `memberId`),
    INDEX `StoreRentalOrder_tenantId_corporateId_idx`(`tenantId`, `corporateId`),
    INDEX `StoreRentalOrder_tenantId_pickupStationId_returnStationId_idx`(`tenantId`, `pickupStationId`, `returnStationId`),
    UNIQUE INDEX `StoreRentalOrder_tenantId_orderNo_key`(`tenantId`, `orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalRuleSet` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `versionNo` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `content` JSON NOT NULL,
    `effectiveAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RentalRuleSet_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `RentalRuleSet_tenantId_code_versionNo_key`(`tenantId`, `code`, `versionNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PricingPlan` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'HKD',
    `status` VARCHAR(191) NOT NULL,
    `currentVersionNo` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PricingPlan_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `PricingPlan_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PricingPlanVersion` (
    `id` VARCHAR(191) NOT NULL,
    `pricingPlanId` VARCHAR(191) NOT NULL,
    `versionNo` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `effectiveAt` DATETIME(3) NULL,
    `content` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PricingPlanVersion_pricingPlanId_versionNo_key`(`pricingPlanId`, `versionNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PricingRuleLine` (
    `id` VARCHAR(191) NOT NULL,
    `pricingPlanVersionId` VARCHAR(191) NOT NULL,
    `vehicleGroupCode` VARCHAR(191) NOT NULL,
    `pickupStoreCode` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `weekday` INTEGER NULL,
    `baseDailyAmount` DECIMAL(12, 2) NOT NULL,
    `weekendDailyAmount` DECIMAL(12, 2) NOT NULL,
    `depositAmount` DECIMAL(12, 2) NOT NULL,

    INDEX `PricingRuleLine_vehicleGroupCode_pickupStoreCode_idx`(`vehicleGroupCode`, `pickupStoreCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceFeeRule` (
    `id` VARCHAR(191) NOT NULL,
    `pricingPlanVersionId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `chargeMode` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `ServiceFeeRule_pricingPlanVersionId_code_key`(`pricingPlanVersionId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeeItem` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `stage` ENUM('pickup', 'rental', 'return_settlement', 'cancellation', 'post_charge') NOT NULL DEFAULT 'rental',
    `direction` ENUM('charge', 'refund', 'waiver') NOT NULL DEFAULT 'charge',
    `status` ENUM('pending', 'settled', 'waived', 'monthly_billing', 'voided') NOT NULL DEFAULT 'pending',
    `amount` DECIMAL(12, 2) NOT NULL,
    `settledAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `pendingAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `source` VARCHAR(191) NOT NULL DEFAULT 'system',
    `description` VARCHAR(191) NULL,
    `snapshotRef` VARCHAR(191) NULL,
    `ruleSnapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FeeItem_orderId_stage_status_idx`(`orderId`, `stage`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TransactionRecord` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `provider` VARCHAR(191) NULL,
    `channel` VARCHAR(191) NULL,
    `operator` VARCHAR(191) NULL,
    `relatedFeeIds` JSON NULL,
    `note` VARCHAR(191) NULL,
    `requestJson` JSON NULL,
    `responseJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TransactionRecord_orderId_type_status_idx`(`orderId`, `type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderInspectionRecord` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(191) NOT NULL,
    `operator` VARCHAR(191) NOT NULL,
    `plateNo` VARCHAR(191) NULL,
    `mileage` INTEGER NULL,
    `fuelLevelPercent` INTEGER NULL,
    `batteryLevelPercent` INTEGER NULL,
    `cleanliness` VARCHAR(191) NULL,
    `damageFound` BOOLEAN NOT NULL DEFAULT false,
    `damageDescription` VARCHAR(191) NULL,
    `missingItems` VARCHAR(191) NULL,
    `photoCount` INTEGER NOT NULL DEFAULT 0,
    `customerSigned` BOOLEAN NOT NULL DEFAULT false,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderInspectionRecord_orderId_stage_idx`(`orderId`, `stage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderTimelineEvent` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `detail` JSON NULL,
    `operator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderTimelineEvent_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderExtensionSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `snapshotRef` VARCHAR(191) NOT NULL,
    `oldReturnAt` DATETIME(3) NOT NULL,
    `newReturnAt` DATETIME(3) NOT NULL,
    `extensionHours` INTEGER NOT NULL,
    `billableDays` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `settlementMode` VARCHAR(191) NOT NULL,
    `ruleSnapshot` JSON NOT NULL,
    `pricingSnapshot` JSON NULL,
    `operator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OrderExtensionSnapshot_orderId_snapshotRef_key`(`orderId`, `snapshotRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OperationLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `detail` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OperationLog_tenantId_action_createdAt_idx`(`tenantId`, `action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConfigVersion` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `versionNo` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `content` JSON NOT NULL,
    `effectiveAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ConfigVersion_tenantId_module_versionNo_key`(`tenantId`, `module`, `versionNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemParameterSet` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `versionNo` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('draft', 'effective', 'archived') NOT NULL DEFAULT 'effective',
    `content` JSON NOT NULL,
    `operator` VARCHAR(191) NULL,
    `effectiveAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SystemParameterSet_tenantId_module_status_idx`(`tenantId`, `module`, `status`),
    UNIQUE INDEX `SystemParameterSet_tenantId_module_versionNo_key`(`tenantId`, `module`, `versionNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntegrationCredential` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `config` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IntegrationCredential_tenantId_provider_purpose_key`(`tenantId`, `provider`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OrganizationUnit` ADD CONSTRAINT `OrganizationUnit_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrganizationUnit` ADD CONSTRAINT `OrganizationUnit_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `OrganizationUnit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `OrganizationUnit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Role` ADD CONSTRAINT `Role_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreStation` ADD CONSTRAINT `StoreStation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleGroup` ADD CONSTRAINT `VehicleGroup_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vehicle` ADD CONSTRAINT `Vehicle_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vehicle` ADD CONSTRAINT `Vehicle_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `OrganizationUnit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vehicle` ADD CONSTRAINT `Vehicle_currentStationId_fkey` FOREIGN KEY (`currentStationId`) REFERENCES `StoreStation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vehicle` ADD CONSTRAINT `Vehicle_vehicleGroupId_fkey` FOREIGN KEY (`vehicleGroupId`) REFERENCES `VehicleGroup`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleLocationEvent` ADD CONSTRAINT `VehicleLocationEvent_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleConditionPhotoRecord` ADD CONSTRAINT `VehicleConditionPhotoRecord_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleMaintenanceRecord` ADD CONSTRAINT `VehicleMaintenanceRecord_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleAccidentRecord` ADD CONSTRAINT `VehicleAccidentRecord_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MembershipPlan` ADD CONSTRAINT `MembershipPlan_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Member` ADD CONSTRAINT `Member_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberRiskEvent` ADD CONSTRAINT `MemberRiskEvent_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `Member`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberTimelineEvent` ADD CONSTRAINT `MemberTimelineEvent_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `Member`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Corporate` ADD CONSTRAINT `Corporate_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorporateContact` ADD CONSTRAINT `CorporateContact_corporateId_fkey` FOREIGN KEY (`corporateId`) REFERENCES `Corporate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorporateContract` ADD CONSTRAINT `CorporateContract_corporateId_fkey` FOREIGN KEY (`corporateId`) REFERENCES `Corporate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorporateMonthlyBill` ADD CONSTRAINT `CorporateMonthlyBill_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorporateMonthlyBill` ADD CONSTRAINT `CorporateMonthlyBill_corporateId_fkey` FOREIGN KEY (`corporateId`) REFERENCES `Corporate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorporateMonthlyBillLine` ADD CONSTRAINT `CorporateMonthlyBillLine_billId_fkey` FOREIGN KEY (`billId`) REFERENCES `CorporateMonthlyBill`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorporateMonthlyBillLine` ADD CONSTRAINT `CorporateMonthlyBillLine_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorporateMonthlyBillSettlement` ADD CONSTRAINT `CorporateMonthlyBillSettlement_billId_fkey` FOREIGN KEY (`billId`) REFERENCES `CorporateMonthlyBill`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreRentalOrder` ADD CONSTRAINT `StoreRentalOrder_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreRentalOrder` ADD CONSTRAINT `StoreRentalOrder_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `Member`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreRentalOrder` ADD CONSTRAINT `StoreRentalOrder_corporateId_fkey` FOREIGN KEY (`corporateId`) REFERENCES `Corporate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreRentalOrder` ADD CONSTRAINT `StoreRentalOrder_vehicleGroupId_fkey` FOREIGN KEY (`vehicleGroupId`) REFERENCES `VehicleGroup`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreRentalOrder` ADD CONSTRAINT `StoreRentalOrder_assignedVehicleId_fkey` FOREIGN KEY (`assignedVehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreRentalOrder` ADD CONSTRAINT `StoreRentalOrder_pickupStationId_fkey` FOREIGN KEY (`pickupStationId`) REFERENCES `StoreStation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreRentalOrder` ADD CONSTRAINT `StoreRentalOrder_returnStationId_fkey` FOREIGN KEY (`returnStationId`) REFERENCES `StoreStation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreRentalOrder` ADD CONSTRAINT `StoreRentalOrder_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalRuleSet` ADD CONSTRAINT `RentalRuleSet_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PricingPlan` ADD CONSTRAINT `PricingPlan_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PricingPlanVersion` ADD CONSTRAINT `PricingPlanVersion_pricingPlanId_fkey` FOREIGN KEY (`pricingPlanId`) REFERENCES `PricingPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PricingRuleLine` ADD CONSTRAINT `PricingRuleLine_pricingPlanVersionId_fkey` FOREIGN KEY (`pricingPlanVersionId`) REFERENCES `PricingPlanVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceFeeRule` ADD CONSTRAINT `ServiceFeeRule_pricingPlanVersionId_fkey` FOREIGN KEY (`pricingPlanVersionId`) REFERENCES `PricingPlanVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeeItem` ADD CONSTRAINT `FeeItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransactionRecord` ADD CONSTRAINT `TransactionRecord_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderInspectionRecord` ADD CONSTRAINT `OrderInspectionRecord_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderTimelineEvent` ADD CONSTRAINT `OrderTimelineEvent_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderExtensionSnapshot` ADD CONSTRAINT `OrderExtensionSnapshot_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OperationLog` ADD CONSTRAINT `OperationLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OperationLog` ADD CONSTRAINT `OperationLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OperationLog` ADD CONSTRAINT `OperationLog_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConfigVersion` ADD CONSTRAINT `ConfigVersion_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SystemParameterSet` ADD CONSTRAINT `SystemParameterSet_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntegrationCredential` ADD CONSTRAINT `IntegrationCredential_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

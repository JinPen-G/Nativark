-- 下线门市（store-rental）域：删除 57 张已无任何代码访问的表。
--
-- 前提（都已完成并各自提交）：
--   1. 管理端不再调用 /store-rental/*，两个 API 客户端都加了门禁反向断言；
--   2. 服务端删除 store-rental 模块（25738 行）与门市时代的 reports 模块（2028 行）；
--   3. seed.ts 删除门市种子数据——它是这批表最后一个写入方。
--
-- 外键顺序由 prisma migrate diff 生成：先 DROP FOREIGN KEY 再 DROP TABLE，
-- 因此不需要关闭 FOREIGN_KEY_CHECKS。
--
-- 同时删除 OperationLog.orderId：它的外键指向 StoreRentalOrder，审计已改用
-- rentalOrderId 指向 Rental Core 订单。
--
-- 刻意**不含** rental_pricing_groups.categoryCode 的改动：那是本次改动之前就存在的
-- 库与 schema 漂移（用改动前的 schema 做 diff 同样会出现），要单独查清再处理。

-- DropForeignKey
ALTER TABLE `ConfigVersion` DROP FOREIGN KEY `ConfigVersion_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `Corporate` DROP FOREIGN KEY `Corporate_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `CorporateContact` DROP FOREIGN KEY `CorporateContact_corporateId_fkey`;

-- DropForeignKey
ALTER TABLE `CorporateContract` DROP FOREIGN KEY `CorporateContract_corporateId_fkey`;

-- DropForeignKey
ALTER TABLE `CorporateMonthlyBill` DROP FOREIGN KEY `CorporateMonthlyBill_corporateId_fkey`;

-- DropForeignKey
ALTER TABLE `CorporateMonthlyBill` DROP FOREIGN KEY `CorporateMonthlyBill_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `CorporateMonthlyBillLine` DROP FOREIGN KEY `CorporateMonthlyBillLine_billId_fkey`;

-- DropForeignKey
ALTER TABLE `CorporateMonthlyBillLine` DROP FOREIGN KEY `CorporateMonthlyBillLine_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `CorporateMonthlyBillSettlement` DROP FOREIGN KEY `CorporateMonthlyBillSettlement_billId_fkey`;

-- DropForeignKey
ALTER TABLE `DispatchEvent` DROP FOREIGN KEY `DispatchEvent_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `DispatchEvent` DROP FOREIGN KEY `DispatchEvent_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `FeeItem` DROP FOREIGN KEY `FeeItem_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `IntegrationCredential` DROP FOREIGN KEY `IntegrationCredential_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `MarketingPlan` DROP FOREIGN KEY `MarketingPlan_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `MarketingPlanVersion` DROP FOREIGN KEY `MarketingPlanVersion_marketingPlanId_fkey`;

-- DropForeignKey
ALTER TABLE `MarketingRuleLine` DROP FOREIGN KEY `MarketingRuleLine_marketingPlanVersionId_fkey`;

-- DropForeignKey
ALTER TABLE `Member` DROP FOREIGN KEY `Member_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `MemberRiskEvent` DROP FOREIGN KEY `MemberRiskEvent_memberId_fkey`;

-- DropForeignKey
ALTER TABLE `MemberTimelineEvent` DROP FOREIGN KEY `MemberTimelineEvent_memberId_fkey`;

-- DropForeignKey
ALTER TABLE `MembershipPlan` DROP FOREIGN KEY `MembershipPlan_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `OperationLog` DROP FOREIGN KEY `OperationLog_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OpsEventLog` DROP FOREIGN KEY `OpsEventLog_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderContractDocument` DROP FOREIGN KEY `OrderContractDocument_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderEventSnapshot` DROP FOREIGN KEY `OrderEventSnapshot_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderExtensionSnapshot` DROP FOREIGN KEY `OrderExtensionSnapshot_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderIdempotencyRecord` DROP FOREIGN KEY `OrderIdempotencyRecord_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderInspectionRecord` DROP FOREIGN KEY `OrderInspectionRecord_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderNotificationRecord` DROP FOREIGN KEY `OrderNotificationRecord_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderOperationLock` DROP FOREIGN KEY `OrderOperationLock_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderOperationRecord` DROP FOREIGN KEY `OrderOperationRecord_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderRemarkRecord` DROP FOREIGN KEY `OrderRemarkRecord_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `OrderTimelineEvent` DROP FOREIGN KEY `OrderTimelineEvent_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `PriceAdjustmentSchedule` DROP FOREIGN KEY `PriceAdjustmentSchedule_pricingPlanId_fkey`;

-- DropForeignKey
ALTER TABLE `PriceAdjustmentSchedule` DROP FOREIGN KEY `PriceAdjustmentSchedule_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `PricingPlan` DROP FOREIGN KEY `PricingPlan_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `PricingPlanVersion` DROP FOREIGN KEY `PricingPlanVersion_pricingPlanId_fkey`;

-- DropForeignKey
ALTER TABLE `PricingQuoteSnapshot` DROP FOREIGN KEY `PricingQuoteSnapshot_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `PricingQuoteSnapshot` DROP FOREIGN KEY `PricingQuoteSnapshot_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `PricingRuleLine` DROP FOREIGN KEY `PricingRuleLine_pricingPlanVersionId_fkey`;

-- DropForeignKey
ALTER TABLE `RentalRuleSet` DROP FOREIGN KEY `RentalRuleSet_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `ReportExportJob` DROP FOREIGN KEY `ReportExportJob_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `ServiceFeeRule` DROP FOREIGN KEY `ServiceFeeRule_pricingPlanVersionId_fkey`;

-- DropForeignKey
ALTER TABLE `StationCalendarDay` DROP FOREIGN KEY `StationCalendarDay_stationId_fkey`;

-- DropForeignKey
ALTER TABLE `StationCapacitySnapshot` DROP FOREIGN KEY `StationCapacitySnapshot_stationId_fkey`;

-- DropForeignKey
ALTER TABLE `StoreRentalOrder` DROP FOREIGN KEY `StoreRentalOrder_assignedVehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `StoreRentalOrder` DROP FOREIGN KEY `StoreRentalOrder_corporateId_fkey`;

-- DropForeignKey
ALTER TABLE `StoreRentalOrder` DROP FOREIGN KEY `StoreRentalOrder_createdById_fkey`;

-- DropForeignKey
ALTER TABLE `StoreRentalOrder` DROP FOREIGN KEY `StoreRentalOrder_memberId_fkey`;

-- DropForeignKey
ALTER TABLE `StoreRentalOrder` DROP FOREIGN KEY `StoreRentalOrder_pickupStationId_fkey`;

-- DropForeignKey
ALTER TABLE `StoreRentalOrder` DROP FOREIGN KEY `StoreRentalOrder_returnStationId_fkey`;

-- DropForeignKey
ALTER TABLE `StoreRentalOrder` DROP FOREIGN KEY `StoreRentalOrder_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `StoreRentalOrder` DROP FOREIGN KEY `StoreRentalOrder_vehicleGroupId_fkey`;

-- DropForeignKey
ALTER TABLE `StoreStation` DROP FOREIGN KEY `StoreStation_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `TboxCommandRecord` DROP FOREIGN KEY `TboxCommandRecord_deviceId_fkey`;

-- DropForeignKey
ALTER TABLE `TboxDevice` DROP FOREIGN KEY `TboxDevice_boundVehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `TboxDevice` DROP FOREIGN KEY `TboxDevice_tenantId_fleet_fkey`;

-- DropForeignKey
ALTER TABLE `TransactionRecord` DROP FOREIGN KEY `TransactionRecord_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `Vehicle` DROP FOREIGN KEY `Vehicle_currentStationId_fkey`;

-- DropForeignKey
ALTER TABLE `Vehicle` DROP FOREIGN KEY `Vehicle_storeId_fkey`;

-- DropForeignKey
ALTER TABLE `Vehicle` DROP FOREIGN KEY `Vehicle_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `Vehicle` DROP FOREIGN KEY `Vehicle_vehicleGroupId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleAccidentRecord` DROP FOREIGN KEY `VehicleAccidentRecord_vehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleAttachmentRecord` DROP FOREIGN KEY `VehicleAttachmentRecord_vehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleConditionPhotoRecord` DROP FOREIGN KEY `VehicleConditionPhotoRecord_vehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleCredentialRecord` DROP FOREIGN KEY `VehicleCredentialRecord_vehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleGroup` DROP FOREIGN KEY `VehicleGroup_tenantId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleLocationEvent` DROP FOREIGN KEY `VehicleLocationEvent_vehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleMaintenanceRecord` DROP FOREIGN KEY `VehicleMaintenanceRecord_vehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleOnboardItem` DROP FOREIGN KEY `VehicleOnboardItem_vehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleStatusChangeRecord` DROP FOREIGN KEY `VehicleStatusChangeRecord_vehicleId_fkey`;

-- DropForeignKey
ALTER TABLE `VehicleTransferTask` DROP FOREIGN KEY `VehicleTransferTask_tenantId_fkey`;

-- DropForeignKey

-- AlterTable
ALTER TABLE `OperationLog` DROP COLUMN `orderId`;

-- AlterTable

-- DropTable
DROP TABLE `ConfigVersion`;

-- DropTable
DROP TABLE `Corporate`;

-- DropTable
DROP TABLE `CorporateContact`;

-- DropTable
DROP TABLE `CorporateContract`;

-- DropTable
DROP TABLE `CorporateMonthlyBill`;

-- DropTable
DROP TABLE `CorporateMonthlyBillLine`;

-- DropTable
DROP TABLE `CorporateMonthlyBillSettlement`;

-- DropTable
DROP TABLE `DispatchEvent`;

-- DropTable
DROP TABLE `FeeItem`;

-- DropTable
DROP TABLE `FinanceDocument`;

-- DropTable
DROP TABLE `FinanceManualAdjustment`;

-- DropTable
DROP TABLE `FinancePreAuthorization`;

-- DropTable
DROP TABLE `IntegrationCredential`;

-- DropTable
DROP TABLE `MarketingPlan`;

-- DropTable
DROP TABLE `MarketingPlanVersion`;

-- DropTable
DROP TABLE `MarketingRuleLine`;

-- DropTable
DROP TABLE `Member`;

-- DropTable
DROP TABLE `MemberRiskEvent`;

-- DropTable
DROP TABLE `MemberTimelineEvent`;

-- DropTable
DROP TABLE `MembershipPlan`;

-- DropTable
DROP TABLE `OpsEventLog`;

-- DropTable
DROP TABLE `OrderContractDocument`;

-- DropTable
DROP TABLE `OrderEventSnapshot`;

-- DropTable
DROP TABLE `OrderExtensionSnapshot`;

-- DropTable
DROP TABLE `OrderIdempotencyRecord`;

-- DropTable
DROP TABLE `OrderInspectionRecord`;

-- DropTable
DROP TABLE `OrderNotificationRecord`;

-- DropTable
DROP TABLE `OrderOperationLock`;

-- DropTable
DROP TABLE `OrderOperationRecord`;

-- DropTable
DROP TABLE `OrderRemarkRecord`;

-- DropTable
DROP TABLE `OrderTimelineEvent`;

-- DropTable
DROP TABLE `PriceAdjustmentSchedule`;

-- DropTable
DROP TABLE `PricingPlan`;

-- DropTable
DROP TABLE `PricingPlanVersion`;

-- DropTable
DROP TABLE `PricingQuoteSnapshot`;

-- DropTable
DROP TABLE `PricingRuleLine`;

-- DropTable
DROP TABLE `RentalRuleSet`;

-- DropTable
DROP TABLE `ReportExportJob`;

-- DropTable
DROP TABLE `ServiceFeeRule`;

-- DropTable
DROP TABLE `StationCalendarDay`;

-- DropTable
DROP TABLE `StationCapacitySnapshot`;

-- DropTable
DROP TABLE `StoreRentalOrder`;

-- DropTable
DROP TABLE `StoreStation`;

-- DropTable
DROP TABLE `TboxCommandRecord`;

-- DropTable
DROP TABLE `TboxDevice`;

-- DropTable
DROP TABLE `TransactionRecord`;

-- DropTable
DROP TABLE `Vehicle`;

-- DropTable
DROP TABLE `VehicleAccidentRecord`;

-- DropTable
DROP TABLE `VehicleAttachmentRecord`;

-- DropTable
DROP TABLE `VehicleConditionPhotoRecord`;

-- DropTable
DROP TABLE `VehicleCredentialRecord`;

-- DropTable
DROP TABLE `VehicleGroup`;

-- DropTable
DROP TABLE `VehicleLocationEvent`;

-- DropTable
DROP TABLE `VehicleMaintenanceRecord`;

-- DropTable
DROP TABLE `VehicleOnboardItem`;

-- DropTable
DROP TABLE `VehicleStatusChangeRecord`;

-- DropTable
DROP TABLE `VehicleTransferTask`;

-- AddForeignKey

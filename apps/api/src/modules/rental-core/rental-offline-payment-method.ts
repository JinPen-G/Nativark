/** 原资金事务兼容入口；收款方式准入与锁定读取单源归Rental Core私有MySQL适配。 */
export { parseRentalOfflinePaymentMethod, assertRentalOfflinePaymentMethodEnabled, assertCurrentOfflinePaymentMethod } from "@rental-os/rental-core/mysql-offline-payment-method";

/** 原业务共享父锁的兼容出口，所有Rental事务继续使用同一参数化SQL及原授权链。 */
export { lockRentalBusinessTenant } from "@rental-os/rental-core/mysql-business-fence";

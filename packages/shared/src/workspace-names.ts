import { RentalCategoryCode } from "./core";

/**
 * 经营空间的默认展示名称。
 *
 * 这是界面与新租户初始化使用的展示文案，不是品类编码；历史订单、权限码和
 * 数据库内部标识仍然使用 RentalCategoryCode。空间名称允许租户后续自行修改。
 */
export const RENTAL_CATEGORY_WORKSPACE_NAMES: Record<RentalCategoryCode, string> = {
  [RentalCategoryCode.Camera]: "摄影设备租赁",
  [RentalCategoryCode.Camping]: "露营装备租赁",
  [RentalCategoryCode.Vehicle]: "车辆载具租赁",
  [RentalCategoryCode.Construction]: "工程设备租赁"
};

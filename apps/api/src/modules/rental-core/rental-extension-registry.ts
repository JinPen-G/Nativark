import {
  RENTAL_CAPABILITY_MODULES,
  type RentalCategoryDefinition
} from "@store-rental/shared";
import { assertRentalPricingStrategiesComplete, rentalPricingStrategy } from "./rental-pricing-strategy";

/**
 * 品类扩展契约门禁。新增品类只能引用已注册的计费策略与 capability；
 * 这样扩展失败会在启动/测试阶段暴露，而不是在某个订单运行到一半时才报错。
 */
export function assertRentalCategoryExtensions(categories: RentalCategoryDefinition[]) {
  assertRentalPricingStrategiesComplete();
  const capabilityCodes = new Set(RENTAL_CAPABILITY_MODULES.map((module) => module.code));
  const categoryCodes = new Set<string>();

  for (const category of categories) {
    if (categoryCodes.has(category.code)) throw new Error(`重复的租赁品类定义：${category.code}`);
    categoryCodes.add(category.code);
    if (!category.businessModel.pricingUnits.includes(category.businessModel.defaultPricingUnit)) {
      throw new Error(`品类 ${category.code} 的默认计费单位未列入支持范围`);
    }
    for (const unit of category.businessModel.pricingUnits) rentalPricingStrategy(unit);
    for (const capability of category.defaultCapabilities) {
      if (!capabilityCodes.has(capability)) throw new Error(`品类 ${category.code} 引用了未注册 capability：${capability}`);
    }
    if (!category.businessModel.locationTypes.includes(category.businessModel.defaults.initialSetup.locationType)) {
      throw new Error(`品类 ${category.code} 的初始地点类型未列入支持范围`);
    }
  }
}

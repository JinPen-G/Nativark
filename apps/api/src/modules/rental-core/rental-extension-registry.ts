import {
  RENTAL_CAPABILITY_MODULES,
  type RentalCapability,
  type RentalCapabilityDefinition,
  type RentalCategoryDefinition
} from "@store-rental/shared";
import { assertRentalPricingStrategiesComplete, rentalPricingStrategy } from "./rental-pricing-strategy";

/**
 * capability 注册表自身的一致性门禁（CORE-EXT-02A）。
 *
 * 依赖、互斥和适用品类都写在注册表里，若引用了未注册的 code 或自相矛盾（自依赖、
 * 既依赖又互斥、依赖一个不适用于同一品类的能力），启用时才报错就太晚了——
 * 那时运营已经在页面上看到一个点不动的开关。因此在启动与测试阶段直接失败。
 */
export function assertRentalCapabilityRegistry(
  modules: RentalCapabilityDefinition[] = RENTAL_CAPABILITY_MODULES
) {
  const byCode = new Map(modules.map((module) => [module.code, module]));
  if (byCode.size !== modules.length) {
    throw new Error("capability 注册表存在重复 code");
  }
  const applicable = (code: RentalCapability) => {
    const found = byCode.get(code);
    return found?.applicableCategories ?? "all";
  };
  for (const module of modules) {
    for (const dependency of module.dependsOn) {
      if (!byCode.has(dependency)) {
        throw new Error(`capability ${module.code} 依赖未注册的能力：${dependency}`);
      }
      if (dependency === module.code) throw new Error(`capability ${module.code} 不能依赖自身`);
      // 依赖必须在本能力适用的每个品类里也适用，否则该品类永远无法满足依赖。
      const own = module.applicableCategories;
      const dep = applicable(dependency);
      if (own !== "all" && dep !== "all") {
        const missing = own.filter((category) => !dep.includes(category));
        if (missing.length) {
          throw new Error(
            `capability ${module.code} 在品类 ${missing.join("、")} 上适用，但其依赖 ${dependency} 不适用于这些品类`
          );
        }
      }
    }
    for (const conflict of module.conflictsWith) {
      if (!byCode.has(conflict)) {
        throw new Error(`capability ${module.code} 声明了未注册的互斥能力：${conflict}`);
      }
      if (conflict === module.code) throw new Error(`capability ${module.code} 不能与自身互斥`);
      if (module.dependsOn.includes(conflict)) {
        throw new Error(`capability ${module.code} 不能同时依赖并互斥 ${conflict}`);
      }
    }
    // 配置 schema 自身也要自洽：枚举必须给可选值，数值上下界不能倒挂。
    const keys = new Set<string>();
    for (const field of module.configSchema) {
      if (keys.has(field.key)) throw new Error(`capability ${module.code} 的配置项 ${field.key} 重复`);
      keys.add(field.key);
      if (field.type === "enum" && !field.options?.length) {
        throw new Error(`capability ${module.code} 的枚举配置项 ${field.key} 缺少可选值`);
      }
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        throw new Error(`capability ${module.code} 的配置项 ${field.key} 上下界倒挂`);
      }
    }
  }
}

/**
 * 品类扩展契约门禁。新增品类只能引用已注册的计费策略与 capability；
 * 这样扩展失败会在启动/测试阶段暴露，而不是在某个订单运行到一半时才报错。
 *
 * `modules` 默认取生产注册表；CORE-EXT-03 用它传入「生产注册表 + 一个测试专用能力」的
 * 候选集，证明「新增品类 + 独立能力」只靠追加注册定义即可通过门禁，无需改动既有能力。
 * 生产启动路径不传此参，因此测试能力绝不会进入生产注册表、Seed 或菜单。
 */
export function assertRentalCategoryExtensions(
  categories: RentalCategoryDefinition[],
  modules: RentalCapabilityDefinition[] = RENTAL_CAPABILITY_MODULES
) {
  assertRentalPricingStrategiesComplete();
  assertRentalCapabilityRegistry(modules);
  const byCode = new Map(modules.map((module) => [module.code, module]));
  const categoryCodes = new Set<string>();

  for (const category of categories) {
    if (categoryCodes.has(category.code)) throw new Error(`重复的租赁品类定义：${category.code}`);
    categoryCodes.add(category.code);
    if (!category.businessModel.pricingUnits.includes(category.businessModel.defaultPricingUnit)) {
      throw new Error(`品类 ${category.code} 的默认计费单位未列入支持范围`);
    }
    for (const unit of category.businessModel.pricingUnits) rentalPricingStrategy(unit);
    for (const capability of category.defaultCapabilities) {
      const definition = byCode.get(capability);
      if (!definition) throw new Error(`品类 ${category.code} 引用了未注册 capability：${capability}`);
      // **不**在这里拦「品类声明了不适用于自己的能力」。
      //
      // 声明与可启用是两件事：`applicableCategories` 决定能不能**启用**，由运行期的能力视图
      // 给出 `applicable: false` 并拒绝启用。若在这里硬失败，新增一个品类就必须回头修改
      // 既有 capability 定义，而 CORE-EXT-03 要求新品类接入只需新增定义、模块、迁移和页面，
      // 不得改动既有品类与共享能力——那条要求会被这道门禁直接否掉。
    }
    const declared = new Set(category.defaultCapabilities);
    for (const capability of category.requiredCapabilities) {
      if (!declared.has(capability)) {
        throw new Error(`品类 ${category.code} 的必选 capability ${capability} 未列入 defaultCapabilities`);
      }
      const definition = byCode.get(capability);
      if (!definition) {
        throw new Error(`品类 ${category.code} 的必选 capability ${capability} 未注册`);
      }
      const applicable =
        definition.applicableCategories === "all" || definition.applicableCategories.includes(category.code);
      if (!applicable) {
        throw new Error(`品类 ${category.code} 的必选 capability ${capability} 不适用于该品类`);
      }
    }
    if (!category.businessModel.locationTypes.includes(category.businessModel.defaults.initialSetup.locationType)) {
      throw new Error(`品类 ${category.code} 的初始地点类型未列入支持范围`);
    }
  }
}

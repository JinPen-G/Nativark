/** 当前经营设置的既有品类兼容投影；不补造持久配置，不用于历史重算。
 * 报价提交复核与Core读取复用同一投影，避免R0与营运端的旧字段语义分叉。 */
import type { RentalCategoryDefinition, TenantRentalBusinessSettings } from '@rental-os/shared';
import type { RentalOpeningConfigurationFacts } from './rental-core-config.repository';

export function normalizeBusinessOptionsForCategory(
  settings: RentalOpeningConfigurationFacts['settings'], definition: RentalCategoryDefinition
) {
  const supportedUnits = new Set(definition.businessModel.pricingUnits);
  const configuredUnits = new Set((settings.pricing.enabledUnits ?? []).filter((unit) => supportedUnits.has(unit)));
  const enabledUnits = definition.businessModel.pricingUnits.filter((unit) => configuredUnits.has(unit));
  const safeUnits = enabledUnits.length ? enabledUnits : [definition.businessModel.defaultPricingUnit];
  const defaultUnit = safeUnits.includes(settings.pricing.defaultUnit)
    ? settings.pricing.defaultUnit
    : definition.businessModel.defaultPricingUnit;

  const supportedModes = new Set(definition.businessModel.fulfillmentModes);
  const configuredModes = new Set((settings.fulfillment.enabledModes ?? []).filter((mode) => supportedModes.has(mode)));
  const enabledModes = definition.businessModel.fulfillmentModes.filter((mode) => configuredModes.has(mode));
  const safeModes = enabledModes.length ? enabledModes : [definition.businessModel.fulfillmentModes[0]];
  return { enabledUnits: safeUnits, defaultUnit, enabledModes: safeModes };
}

export function normalizeBusinessSettingsForCategory(settings: TenantRentalBusinessSettings, definition: RentalCategoryDefinition): TenantRentalBusinessSettings {
  const { enabledUnits: safeUnits, defaultUnit, enabledModes: safeModes } = normalizeBusinessOptionsForCategory(settings, definition);
  return {
    ...settings,
    pricing: {
      ...settings.pricing,
      enabledUnits: safeUnits,
      defaultUnit,
      holidayPricingEnabled: definition.businessModel.supportsHolidayPricing && settings.pricing.holidayPricingEnabled
    },
    fulfillment: {
      ...settings.fulfillment,
      enabledModes: safeModes,
      // 兼容尚未带服务区域的旧 JSON 设置；只有管理员显式配置 allowlist 才限制报价。
      deliveryServiceArea: settings.fulfillment.deliveryServiceArea?.mode === "allowlist"
        ? {
            mode: "allowlist",
            areas: Array.isArray(settings.fulfillment.deliveryServiceArea.areas)
              ? settings.fulfillment.deliveryServiceArea.areas
              : []
          }
        : { mode: "all", areas: [] }
    },
    calendar: {
      ...settings.calendar,
      holidayPricingEnabled: definition.businessModel.supportsHolidayPricing && settings.calendar.holidayPricingEnabled
    }
  };
}

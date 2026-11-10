/** Core-owned creation blueprints. They copy definition data only; no merchant facts, activation, pricing or new algorithm. */
import { BadRequestException } from "@nestjs/common";
import { RENTAL_CATEGORY_DEFINITIONS, RentalInventoryMode, isRentalCategoryCode,
  type RentalCategoryDefinition, type PreviewRentalCategoryCreationRequest, type RentalCapability } from "@rental-os/shared";
import { requestFingerprint } from "./rental-idempotency.repository";

function genericDefinition(templateId: "serialized" | "quantity" | "kit"): RentalCategoryDefinition {
  const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === (templateId === "quantity" ? "camping" : "camera"))!);
  const inventoryModes = templateId === "quantity" ? [RentalInventoryMode.Quantity] : templateId === "serialized" ? [RentalInventoryMode.Serialized]
    : [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle];
  definition.name = templateId === "kit" ? "通用套装租赁" : templateId === "quantity" ? "数量物品租赁" : "单件物品租赁";
  definition.description = "组合已有库存、计价与履约能力，经营资料由商户另行配置。";
  definition.version = "rental-template-1";
  definition.supportedInventoryModes = inventoryModes;
  definition.defaultCapabilities = [templateId === "quantity" ? "quantity_inventory" : "serialized_inventory", "pickup", "return"];
  if (templateId === "kit") definition.defaultCapabilities.push("quantity_inventory", "bundle_inventory", "kit_handover");
  definition.requiredCapabilities = [];
  definition.terminology = { itemLabel: "商品", itemGroupLabel: "商品型号", assetLabel: "资产", fulfillmentLabel: "经营地点", pickupLabel: "领取", returnLabel: "归还", identifierLabel: "资产编号" };
  definition.display = { icon: "rental" };
  definition.attributeSchema = templateId === "quantity" ? { brand: "string", model: "string" } : { brand: "string", model: "string", serialNo: "string" };
  definition.businessModel.assetFields = [{ code: "brand", label: "品牌", type: "string", scope: "item_group", clientVisible: true },
    { code: "model", label: "型号", type: "string", scope: "item_group", clientVisible: true }, { code: "serialNo", label: "序列号", type: "string", scope: "asset", unique: true }];
  if (templateId === "quantity") definition.businessModel.assetFields = definition.businessModel.assetFields.filter(field => field.scope === "item_group");
  definition.businessModel.catalogPresentation = undefined;
  definition.businessModel.fulfillmentModes = ["store_pickup_return"];
  definition.businessModel.locationTypes = ["store", "warehouse"];
  definition.businessModel.valueAddedServicePresets = [];
  definition.businessModel.supportsPreauthorization = false;
  definition.businessModel.supportsQualificationReview = false;
  definition.businessModel.defaults.initialSetup = { operatorName: "本商户", locationName: "经营地点", locationType: "store" };
  definition.businessModel.defaults.rules.qualificationDocumentTypes = [];
  definition.businessModel.defaults.sampleBaseAmount = 0;
  definition.businessModel.defaults.sampleAmountIncrement = 0;
  definition.businessModel.defaults.inspectionFields = [{ code: "condition", label: "状况正常", type: "boolean", required: true }];
  if (templateId === "kit") {
    definition.conditionalCapabilities = [{ code: "kit_handover", when: { inventoryModes: [RentalInventoryMode.Bundle] } }];
    definition.businessModel.defaults.inspectionFields.push({ code: "kit_complete", label: "套装附件齐全", type: "boolean", required: true, appliesToCapability: "kit_handover" });
  }
  return definition;
}

export function categoryCreationTemplates() {
  return (["serialized", "quantity", "kit"] as const).map(id => ({ id, revision: "rental-template-1", definition: genericDefinition(id) }));
}

/** Selections are subsets of one fixed source. The resulting identity and body are independent of that source. */
export function composeCategoryCreation(source: RentalCategoryDefinition, input: PreviewRentalCategoryCreationRequest) {
  if (!isRentalCategoryCode(input.code)) throw new BadRequestException("品类编码格式无效");
  if (!input.name?.trim() || input.name.trim().length > 100 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?![\s\S])/u.test(input.versionLabel)) throw new BadRequestException("品类名称或版本号格式无效");
  const subset = (value: unknown, allowed: readonly string[], label: string, max: number) => {
    if (!Array.isArray(value) || !value.length || value.length > max || new Set(value).size !== value.length || value.some(entry => typeof entry !== "string" || !allowed.includes(entry))) {
      throw new BadRequestException(`${label}须为来源支持范围内的非空选择`);
    }
  };
  subset(input.inventoryModes, source.supportedInventoryModes, "库存形态", 4);
  subset(input.pricingUnits, source.businessModel.pricingUnits, "计价单位", 20);
  subset(input.fulfillmentModes, source.businessModel.fulfillmentModes, "履约方式", 16);
  subset(input.capabilityCodes, source.defaultCapabilities, "能力组合", 100);
  if (!input.pricingUnits.includes(input.defaultPricingUnit)) throw new BadRequestException("默认计价单位不在所选范围内");
  const mandatory: RentalCapability[] = ["pickup", "return"];
  if (input.inventoryModes.includes(RentalInventoryMode.Serialized) || input.inventoryModes.includes(RentalInventoryMode.Bundle)) mandatory.push("serialized_inventory");
  if (input.inventoryModes.includes(RentalInventoryMode.Quantity) || input.inventoryModes.includes(RentalInventoryMode.Consumable)) mandatory.push("quantity_inventory");
  if (input.inventoryModes.includes(RentalInventoryMode.Bundle)) mandatory.push("bundle_inventory");
  if (mandatory.some(code => !input.capabilityCodes.includes(code))) throw new BadRequestException("所选库存及履约方式缺少基础能力");
  const definition = structuredClone(source);
  definition.code = input.code; definition.name = input.name.trim(); definition.version = input.versionLabel;
  definition.supportedInventoryModes = [...input.inventoryModes]; definition.defaultCapabilities = [...input.capabilityCodes];
  definition.requiredCapabilities = definition.requiredCapabilities.filter(code => input.capabilityCodes.includes(code));
  definition.conditionalCapabilities = definition.conditionalCapabilities?.filter(row => input.capabilityCodes.includes(row.code));
  definition.businessModel.defaults.inspectionFields = definition.businessModel.defaults.inspectionFields.filter(field => !field.appliesToCapability || input.capabilityCodes.includes(field.appliesToCapability));
  definition.businessModel.pricingUnits = [...input.pricingUnits]; definition.businessModel.defaultPricingUnit = input.defaultPricingUnit;
  definition.businessModel.fulfillmentModes = [...input.fulfillmentModes];
  return { definition, definitionHash: requestFingerprint(definition), removedCapabilities: source.defaultCapabilities.filter(code => !input.capabilityCodes.includes(code)) };
}

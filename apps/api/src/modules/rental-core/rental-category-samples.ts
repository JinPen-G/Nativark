import {
  RentalAssetStatus,
  RentalCategoryCode,
  RentalInventoryMode,
  type RentalAsset,
  type RentalFulfillmentLocation,
  type RentalItemGroup,
  type RentalStockBalance
} from "@store-rental/shared";

interface RentalCategorySampleInput {
  tenantId: string;
  idPrefix: string;
  categoryCode: RentalCategoryCode;
  location: RentalFulfillmentLocation;
  timestamp: string;
}

interface RentalCategorySampleCatalog {
  itemGroups: RentalItemGroup[];
  assets: RentalAsset[];
  stockBalances: RentalStockBalance[];
}

type RentalCategorySampleFactory = (input: RentalCategorySampleInput) => RentalCategorySampleCatalog;

const emptyCatalog = (): RentalCategorySampleCatalog => ({ itemGroups: [], assets: [], stockBalances: [] });

const itemGroup = (
  input: RentalCategorySampleInput,
  code: string,
  name: string,
  inventoryMode: RentalInventoryMode,
  unit: string,
  attributes: Record<string, unknown> = {}
): RentalItemGroup => ({
  id: `${input.idPrefix}_${code.toLowerCase()}`,
  tenantId: input.tenantId,
  categoryCode: input.categoryCode,
  code,
  name,
  inventoryMode,
  unit,
  attributes,
  bundleComponents: [],
  status: "enabled",
  createdAt: input.timestamp,
  updatedAt: input.timestamp
});

const cameraSamples: RentalCategorySampleFactory = (input) => {
  const body = itemGroup(input, "CAM-BODY", "全画幅相机机身", RentalInventoryMode.Serialized, "台", {
    brand: "Sony", model: "Alpha 7 IV", mount: "E", sensor: "全画幅"
  });
  const lens = itemGroup(input, "CAM-LENS", "24-70mm 标准镜头", RentalInventoryMode.Serialized, "支", {
    brand: "Sony", model: "FE 24-70mm F2.8 GM II", mount: "E"
  });
  const bundle = itemGroup(input, "CAM-KIT", "标准拍摄套装", RentalInventoryMode.Bundle, "套");
  bundle.bundleComponents = [body, lens].map((row) => ({
    itemGroupId: row.id, itemGroupCode: row.code, itemGroupName: row.name, quantity: 1
  }));
  const groups = [body, lens, bundle];
  const assets = groups
    .filter((row) => row.inventoryMode === RentalInventoryMode.Serialized)
    .flatMap((group, groupIndex) => Array.from({ length: 3 }, (_, index) => ({
      id: `${group.id}_asset_${index + 1}`,
      tenantId: input.tenantId,
      itemGroupId: group.id,
      itemGroupCode: group.code,
      itemGroupName: group.name,
      assetNo: `${group.code}-${String(index + 1).padStart(3, "0")}`,
      serialNo: `SN${groupIndex + 1}${index + 1}0001`,
      locationId: input.location.id,
      locationName: input.location.name,
      status: RentalAssetStatus.Available,
      attributes: {},
      createdAt: input.timestamp,
      updatedAt: input.timestamp
    })));
  return { itemGroups: groups, assets, stockBalances: [] };
};

const campingSamples: RentalCategorySampleFactory = (input) => {
  const tent = itemGroup(input, "CAMP-TENT", "四人露营帐篷", RentalInventoryMode.Quantity, "顶", {
    brand: "Naturehike", model: "Cloud Up 4", people: 4, season: "三季"
  });
  const chair = itemGroup(input, "CAMP-CHAIR", "折叠露营椅", RentalInventoryMode.Quantity, "把", {
    brand: "Helinox", model: "Chair One"
  });
  const bundle = itemGroup(input, "CAMP-KIT", "双人露营套装", RentalInventoryMode.Bundle, "套");
  bundle.bundleComponents = [tent, chair].map((row) => ({
    itemGroupId: row.id,
    itemGroupCode: row.code,
    itemGroupName: row.name,
    quantity: row === chair ? 2 : 1
  }));
  const groups = [tent, chair, bundle];
  const stockBalances = groups
    .filter((row) => row.inventoryMode === RentalInventoryMode.Quantity)
    .map((group, index) => ({
      id: `${group.id}_stock`,
      tenantId: input.tenantId,
      itemGroupId: group.id,
      itemGroupCode: group.code,
      itemGroupName: group.name,
      locationId: input.location.id,
      locationName: input.location.name,
      onHandQuantity: index === 0 ? 12 : 24,
      reservedQuantity: 0,
      maintenanceQuantity: index === 0 ? 1 : 2,
      availableQuantity: index === 0 ? 11 : 22,
      updatedAt: input.timestamp
    }));
  return { itemGroups: groups, assets: [], stockBalances };
};

/** 演示数据也通过独立注册表提供，避免样本分支渗入 Rental Core 主流程。 */
const sampleFactories: Partial<Record<RentalCategoryCode, RentalCategorySampleFactory>> = {
  [RentalCategoryCode.Camera]: cameraSamples,
  [RentalCategoryCode.Camping]: campingSamples
};

export function buildRentalCategorySamples(input: RentalCategorySampleInput): RentalCategorySampleCatalog {
  return sampleFactories[input.categoryCode]?.(input) ?? emptyCatalog();
}

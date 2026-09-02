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
  /** 演示用商业分组名称；产品型号名称不得再次承担“车组/器材组”语义。 */
  pricingGroupNames?: Record<string, string>;
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

const vehicleSamples: RentalCategorySampleFactory = (input) => {
  const sedan = itemGroup(input, "VEH-ROEWE-D7", "荣威 D7 标准版", RentalInventoryMode.Serialized, "辆", {
    manufacturer: "上汽集团", brand: "荣威", model: "D7", trim: "标准版", modelYear: 2026, seats: 5, transmission: "自动", energyType: "混动"
  });
  const suv = itemGroup(input, "VEH-LYNK-08", "领克 08 Pro", RentalInventoryMode.Serialized, "辆", {
    manufacturer: "吉利汽车", brand: "领克", model: "08", trim: "Pro", modelYear: 2026, seats: 5, transmission: "自动", energyType: "混动"
  });
  const assets = [sedan, suv].flatMap((group, groupIndex) => Array.from({ length: 2 }, (_, index) => {
    const sequence = groupIndex * 2 + index + 1;
    return {
      id: `${group.id}_asset_${index + 1}`,
      tenantId: input.tenantId,
      itemGroupId: group.id,
      itemGroupCode: group.code,
      itemGroupName: group.name,
      assetNo: `VEH-${String(sequence).padStart(3, "0")}`,
      locationId: input.location.id,
      locationName: input.location.name,
      status: RentalAssetStatus.Available,
      attributes: { licensePlate: `粤B·R${String(sequence).padStart(4, "0")}`, vin: `LDEMO2026VEH${String(sequence).padStart(4, "0")}`, color: index === 0 ? "白色" : "黑色", firstRegistrationDate: "2026-01-15" },
      createdAt: input.timestamp,
      updatedAt: input.timestamp
    };
  }));
  return {
    itemGroups: [sedan, suv],
    assets,
    stockBalances: [],
    pricingGroupNames: { [sedan.id]: "标准轿车组", [suv.id]: "城市 SUV 组" }
  };
};

const constructionSamples: RentalCategorySampleFactory = (input) => {
  const excavator = itemGroup(input, "CON-EXCAVATOR", "小型挖掘机", RentalInventoryMode.Serialized, "台", {
    manufacturer: "三一重工", brand: "SANY", model: "SY35U", power: "21.5kW", ratedLoad: 3.78
  });
  const barriers = itemGroup(input, "CON-BARRIER", "施工围挡", RentalInventoryMode.Quantity, "片", {
    manufacturer: "演示工程物资", brand: "RIMO", model: "B-2000", ratedLoad: 20
  });
  const asset: RentalAsset = {
    id: `${excavator.id}_asset_1`,
    tenantId: input.tenantId,
    itemGroupId: excavator.id,
    itemGroupCode: excavator.code,
    itemGroupName: excavator.name,
    assetNo: "CON-EXC-001",
    locationId: input.location.id,
    locationName: input.location.name,
    status: RentalAssetStatus.Available,
    attributes: { factoryNo: "SANY-SY35U-0001", inspectionExpiry: "2027-12-31" },
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  };
  const stock: RentalStockBalance = {
    id: `${barriers.id}_stock`,
    tenantId: input.tenantId,
    itemGroupId: barriers.id,
    itemGroupCode: barriers.code,
    itemGroupName: barriers.name,
    locationId: input.location.id,
    locationName: input.location.name,
    onHandQuantity: 40,
    reservedQuantity: 0,
    maintenanceQuantity: 2,
    availableQuantity: 38,
    updatedAt: input.timestamp
  };
  return { itemGroups: [excavator, barriers], assets: [asset], stockBalances: [stock] };
};

/** 演示数据也通过独立注册表提供，避免样本分支渗入 Rental Core 主流程。 */
const sampleFactories: Partial<Record<RentalCategoryCode, RentalCategorySampleFactory>> = {
  [RentalCategoryCode.Camera]: cameraSamples,
  [RentalCategoryCode.Camping]: campingSamples,
  [RentalCategoryCode.Vehicle]: vehicleSamples,
  [RentalCategoryCode.Construction]: constructionSamples
};

export function buildRentalCategorySamples(input: RentalCategorySampleInput): RentalCategorySampleCatalog {
  return sampleFactories[input.categoryCode]?.(input) ?? emptyCatalog();
}

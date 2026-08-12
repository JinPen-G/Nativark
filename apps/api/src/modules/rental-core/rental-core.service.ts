import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  RentalAssetStatus,
  RentalCategoryCode,
  RentalCoreOrderStatus,
  RentalInventoryMode,
  RentalReservationStatus,
  type CreateRentalInspectionRequest,
  type CreateRentalOrderRequest,
  type RentalAllocation,
  type RentalAsset,
  type RentalAvailabilityRequest,
  type RentalAvailabilityResult,
  type RentalBundleComponent,
  type RentalCapability,
  type RentalCategoryDefinition,
  type RentalFulfillmentLocation,
  type RentalInspectionRecord,
  type RentalInspectionTemplate,
  type RentalItemGroup,
  type RentalOrder,
  type RentalReservation,
  type RentalStockBalance,
  type SaveRentalAssetRequest,
  type SaveRentalItemGroupRequest,
  type SaveRentalStockBalanceRequest,
  type SaveTenantRentalProfileRequest,
  type TenantRentalProfile
} from "@store-rental/shared";

interface TenantRentalState {
  profile: TenantRentalProfile;
  locations: RentalFulfillmentLocation[];
  itemGroups: RentalItemGroup[];
  assets: RentalAsset[];
  stockBalances: RentalStockBalance[];
  orders: RentalOrder[];
  inspectionTemplates: RentalInspectionTemplate[];
  inspections: RentalInspectionRecord[];
}

const categories: RentalCategoryDefinition[] = [
  {
    code: RentalCategoryCode.Camera,
    name: "摄影设备",
    description: "机身、镜头、灯光和拍摄套装租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "usage_reading"],
    terminology: { itemLabel: "器材", itemGroupLabel: "器材型号", assetLabel: "器材资产", fulfillmentLabel: "器材门店", pickupLabel: "取机", returnLabel: "还机", identifierLabel: "资产编号", usageMetricLabel: "快门次数" },
    attributeSchema: { brand: "string", mount: "string", sensor: "string" },
    version: "0.1.0"
  },
  {
    code: RentalCategoryCode.Camping,
    name: "露营设备",
    description: "帐篷、桌椅、炊具和露营套装租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery"],
    terminology: { itemLabel: "装备", itemGroupLabel: "装备品类", assetLabel: "装备资产", fulfillmentLabel: "装备仓", pickupLabel: "领用", returnLabel: "归还", identifierLabel: "装备编号" },
    attributeSchema: { brand: "string", people: "number", season: "string" },
    version: "0.1.0"
  },
  {
    code: RentalCategoryCode.Vehicle,
    name: "车辆载具",
    description: "汽车、摩托车和其他载具租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "bundle_inventory", "pickup", "return", "dispatch", "usage_reading", "qualification", "iot"],
    terminology: { itemLabel: "车辆", itemGroupLabel: "车型组", assetLabel: "车辆", fulfillmentLabel: "门店", pickupLabel: "取车", returnLabel: "还车", identifierLabel: "车牌号", usageMetricLabel: "里程" },
    attributeSchema: { brand: "string", model: "string", energyType: "string" },
    version: "0.1.0"
  },
  {
    code: RentalCategoryCode.Construction,
    name: "工程设备",
    description: "工程机械、工具和配套设备租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "dispatch", "usage_reading", "qualification", "iot"],
    terminology: { itemLabel: "设备", itemGroupLabel: "设备型号", assetLabel: "设备资产", fulfillmentLabel: "设备仓", pickupLabel: "出库", returnLabel: "入库", identifierLabel: "设备编号", usageMetricLabel: "工时" },
    attributeSchema: { brand: "string", power: "string", ratedLoad: "number" },
    version: "0.1.0"
  }
];

function now() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}_${randomUUID().slice(0, 8)}`; }
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();
}

@Injectable()
export class RentalCoreService {
  private readonly states = new Map<string, TenantRentalState>();

  listCategories() { return categories; }
  getProfile(tenantId: string) { return this.state(tenantId).profile; }

  saveProfile(tenantId: string, input: SaveTenantRentalProfileRequest) {
    const state = this.state(tenantId);
    const definition = this.category(input.categoryCode);
    const categoryChanged = state.profile.categoryCode !== input.categoryCode;
    if (categoryChanged && (state.itemGroups.length > 0 || state.orders.length > 0)) {
      throw new ConflictException("租户已有标的或订单，不能直接切换经营品类");
    }
    const allowed = new Set(definition.defaultCapabilities);
    const capabilities = (input.capabilities ?? definition.defaultCapabilities).filter((item) => allowed.has(item));
    state.profile = {
      ...state.profile,
      categoryCode: input.categoryCode,
      capabilities,
      terminology: { ...definition.terminology, ...input.terminology },
      configVersion: definition.version,
      updatedAt: now()
    };
    if (categoryChanged) state.inspectionTemplates = this.buildInspectionTemplates(tenantId, input.categoryCode);
    return state.profile;
  }

  listLocations(tenantId: string) { return this.state(tenantId).locations; }
  listItemGroups(tenantId: string) { return this.state(tenantId).itemGroups; }

  saveItemGroup(tenantId: string, input: SaveRentalItemGroupRequest) {
    const state = this.state(tenantId);
    const definition = this.category(state.profile.categoryCode);
    if (!definition.supportedInventoryModes.includes(input.inventoryMode)) throw new BadRequestException("当前经营品类不支持该库存模式");
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("标的编码和名称不能为空");
    const duplicate = state.itemGroups.find((row) => row.code === input.code && row.id !== input.id);
    if (duplicate) throw new ConflictException("标的编码已存在");
    const components = this.resolveComponents(state, input.bundleComponents ?? [], input.id);
    if (input.inventoryMode === RentalInventoryMode.Bundle && components.length === 0) throw new BadRequestException("套装至少需要一个组成项");
    if (input.inventoryMode !== RentalInventoryMode.Bundle && components.length > 0) throw new BadRequestException("仅套装模式可以配置组成项");
    const timestamp = now();
    const existing = input.id ? state.itemGroups.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("标的分组不存在");
    const result: RentalItemGroup = {
      id: existing?.id ?? id("group"), tenantId, categoryCode: state.profile.categoryCode,
      code: input.code.trim(), name: input.name.trim(), inventoryMode: input.inventoryMode,
      unit: input.unit?.trim() || "件", description: input.description?.trim(), attributes: input.attributes ?? {},
      bundleComponents: components, status: input.status ?? existing?.status ?? "enabled",
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    if (existing) state.itemGroups.splice(state.itemGroups.indexOf(existing), 1, result); else state.itemGroups.unshift(result);
    return result;
  }

  listAssets(tenantId: string) { return this.state(tenantId).assets; }
  saveAsset(tenantId: string, input: SaveRentalAssetRequest) {
    const state = this.state(tenantId);
    const group = this.group(state, input.itemGroupId);
    if (group.inventoryMode !== RentalInventoryMode.Serialized) throw new BadRequestException("只有序列化库存可以登记独立资产");
    const location = this.location(state, input.locationId);
    if (!input.assetNo?.trim()) throw new BadRequestException("资产编号不能为空");
    if (state.assets.some((row) => row.assetNo === input.assetNo && row.id !== input.id)) throw new ConflictException("资产编号已存在");
    const timestamp = now();
    const existing = input.id ? state.assets.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("资产不存在");
    const result: RentalAsset = {
      id: existing?.id ?? id("asset"), tenantId, itemGroupId: group.id, itemGroupCode: group.code,
      itemGroupName: group.name, assetNo: input.assetNo.trim(), serialNo: input.serialNo?.trim(),
      locationId: location.id, locationName: location.name, status: input.status ?? existing?.status ?? RentalAssetStatus.Available,
      attributes: input.attributes ?? {}, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    if (existing) state.assets.splice(state.assets.indexOf(existing), 1, result); else state.assets.unshift(result);
    return result;
  }

  listStockBalances(tenantId: string) {
    const state = this.state(tenantId);
    return state.stockBalances.map((row) => {
      const reservedQuantity = this.activeReservations(state, row.itemGroupId, row.locationId).reduce((sum, item) => sum + item.quantity, 0);
      return { ...row, reservedQuantity, availableQuantity: Math.max(0, row.onHandQuantity - row.maintenanceQuantity - reservedQuantity) };
    });
  }

  saveStockBalance(tenantId: string, input: SaveRentalStockBalanceRequest) {
    const state = this.state(tenantId);
    const group = this.group(state, input.itemGroupId);
    if (group.inventoryMode !== RentalInventoryMode.Quantity) throw new BadRequestException("只有数量型库存可以维护库存余额");
    const location = this.location(state, input.locationId);
    if (!Number.isInteger(input.onHandQuantity) || input.onHandQuantity < 0) throw new BadRequestException("在手数量必须是非负整数");
    const maintenance = input.maintenanceQuantity ?? 0;
    if (!Number.isInteger(maintenance) || maintenance < 0 || maintenance > input.onHandQuantity) throw new BadRequestException("维护数量无效");
    const existing = state.stockBalances.find((row) => row.itemGroupId === group.id && row.locationId === location.id);
    const result: RentalStockBalance = {
      id: existing?.id ?? id("stock"), tenantId, itemGroupId: group.id, itemGroupCode: group.code,
      itemGroupName: group.name, locationId: location.id, locationName: location.name,
      onHandQuantity: input.onHandQuantity, reservedQuantity: existing?.reservedQuantity ?? 0,
      maintenanceQuantity: maintenance, availableQuantity: Math.max(0, input.onHandQuantity - maintenance), updatedAt: now()
    };
    if (existing) state.stockBalances.splice(state.stockBalances.indexOf(existing), 1, result); else state.stockBalances.unshift(result);
    return this.listStockBalances(tenantId).find((row) => row.id === result.id)!;
  }

  availability(tenantId: string, input: RentalAvailabilityRequest): RentalAvailabilityResult {
    const state = this.state(tenantId);
    this.validatePeriod(input.startAt, input.endAt);
    this.location(state, input.locationId);
    if (!input.lines?.length) throw new BadRequestException("至少需要一个租赁明细");
    const lines = input.lines.map((line) => {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new BadRequestException("租赁数量必须是正整数");
      const group = this.group(state, line.itemGroupId);
      const availableQuantity = this.availableQuantity(state, group, input.locationId, input.startAt, input.endAt, new Set());
      return {
        itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, inventoryMode: group.inventoryMode,
        requestedQuantity: line.quantity, availableQuantity, available: availableQuantity >= line.quantity,
        reasons: availableQuantity >= line.quantity ? [] : [`可用 ${availableQuantity}，需求 ${line.quantity}`]
      };
    });
    const demand = new Map<string, number>();
    for (const line of input.lines) {
      const group = this.group(state, line.itemGroupId);
      const targets = group.inventoryMode === RentalInventoryMode.Bundle
        ? group.bundleComponents.filter((component) => !component.optional).map((component) => ({ itemGroupId: component.itemGroupId, quantity: component.quantity * line.quantity }))
        : [{ itemGroupId: group.id, quantity: line.quantity }];
      for (const target of targets) demand.set(target.itemGroupId, (demand.get(target.itemGroupId) ?? 0) + target.quantity);
    }
    for (const [itemGroupId, requested] of demand) {
      const dependency = this.group(state, itemGroupId);
      const available = this.availableQuantity(state, dependency, input.locationId, input.startAt, input.endAt, new Set());
      if (available < requested) {
        for (const line of lines) {
          const source = this.group(state, line.itemGroupId);
          if (source.id === itemGroupId || source.bundleComponents.some((component) => component.itemGroupId === itemGroupId && !component.optional)) {
            line.available = false;
            line.reasons.push(`${dependency.name} 合并需求 ${requested}，可用 ${available}`);
          }
        }
      }
    }
    return { available: lines.every((line) => line.available), locationId: input.locationId, startAt: input.startAt, endAt: input.endAt, lines };
  }

  listOrders(tenantId: string) { return this.state(tenantId).orders; }
  getOrder(tenantId: string, orderId: string) { return this.order(this.state(tenantId), orderId); }

  createOrder(tenantId: string, input: CreateRentalOrderRequest, userName: string) {
    const state = this.state(tenantId);
    if (!input.customerName?.trim()) throw new BadRequestException("客户名称不能为空");
    const checked = this.availability(tenantId, {
      locationId: input.fulfillmentLocationId, startAt: input.startAt, endAt: input.endAt,
      lines: input.lines.map((line) => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }))
    });
    if (!checked.available) throw new ConflictException("所选时间段库存不足");
    const location = this.location(state, input.fulfillmentLocationId);
    const timestamp = now();
    const orderId = id("order");
    const orderLines = input.lines.map((line) => {
      const group = this.group(state, line.itemGroupId);
      if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) throw new BadRequestException("单价必须是非负数");
      return { id: id("line"), itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, inventoryMode: group.inventoryMode, quantity: line.quantity, unitPrice: line.unitPrice, amount: line.quantity * line.unitPrice, note: line.note };
    });
    const reservations: RentalReservation[] = [];
    for (const line of orderLines) {
      const group = this.group(state, line.itemGroupId);
      const reservationTargets = group.inventoryMode === RentalInventoryMode.Bundle
        ? group.bundleComponents.map((component) => ({ itemGroupId: component.itemGroupId, quantity: component.quantity * line.quantity }))
        : [{ itemGroupId: group.id, quantity: line.quantity }];
      for (const target of reservationTargets) reservations.push({
        id: id("reservation"), orderId, orderLineId: line.id, itemGroupId: target.itemGroupId,
        locationId: location.id, quantity: target.quantity, status: RentalReservationStatus.Soft,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), createdAt: timestamp
      });
    }
    const order: RentalOrder = {
      id: orderId, tenantId, orderNo: `RC${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}${String(state.orders.length + 1).padStart(3, "0")}`,
      categoryCode: state.profile.categoryCode, status: RentalCoreOrderStatus.Draft,
      customerType: input.customerType, customerId: input.customerId, customerName: input.customerName.trim(), contactPhone: input.contactPhone?.trim(),
      fulfillmentLocationId: location.id, fulfillmentLocationName: location.name, startAt: input.startAt, endAt: input.endAt,
      totalAmount: orderLines.reduce((sum, line) => sum + line.amount, 0), lines: orderLines,
      reservations, allocations: [], createdBy: input.operator || userName, createdAt: timestamp, updatedAt: timestamp
    };
    state.orders.unshift(order);
    return order;
  }

  confirmOrder(tenantId: string, orderId: string) {
    const order = this.order(this.state(tenantId), orderId);
    if (order.status !== RentalCoreOrderStatus.Draft) throw new ConflictException("只有草稿订单可以确认");
    if (order.reservations.some((row) => row.expiresAt && new Date(row.expiresAt).getTime() < Date.now())) throw new ConflictException("软预占已过期，请重新下单");
    order.reservations.forEach((row) => { row.status = RentalReservationStatus.Confirmed; row.expiresAt = undefined; });
    order.status = RentalCoreOrderStatus.Reserved; order.updatedAt = now();
    return order;
  }

  allocateOrder(tenantId: string, orderId: string) {
    const state = this.state(tenantId); const order = this.order(state, orderId);
    if (order.status !== RentalCoreOrderStatus.Reserved) throw new ConflictException("只有已确认预占的订单可以配货");
    const allocations: RentalAllocation[] = [];
    for (const reservation of order.reservations) {
      const group = this.group(state, reservation.itemGroupId);
      if (group.inventoryMode === RentalInventoryMode.Serialized) {
        const used = new Set(state.orders.flatMap((item) => item.allocations.filter((allocation) => ["allocated", "picked_up"].includes(allocation.status)).map((allocation) => allocation.assetId)));
        const assets = state.assets.filter((asset) => asset.itemGroupId === group.id && asset.locationId === reservation.locationId && asset.status === RentalAssetStatus.Available && !used.has(asset.id)).slice(0, reservation.quantity);
        if (assets.length < reservation.quantity) throw new ConflictException(`${group.name} 可分配资产不足`);
        assets.forEach((asset) => { asset.status = RentalAssetStatus.Reserved; asset.updatedAt = now(); allocations.push({ id: id("allocation"), orderId, orderLineId: reservation.orderLineId, assetId: asset.id, assetNo: asset.assetNo, quantity: 1, status: "allocated" }); });
      } else {
        allocations.push({ id: id("allocation"), orderId, orderLineId: reservation.orderLineId, quantity: reservation.quantity, status: "allocated" });
      }
    }
    order.allocations = allocations; order.status = RentalCoreOrderStatus.ReadyForPickup; order.updatedAt = now();
    return order;
  }

  cancelOrder(tenantId: string, orderId: string) {
    const state = this.state(tenantId); const order = this.order(state, orderId);
    if ([RentalCoreOrderStatus.Renting, RentalCoreOrderStatus.Completed, RentalCoreOrderStatus.Cancelled].includes(order.status)) throw new ConflictException("当前订单状态不能取消");
    order.reservations.forEach((row) => { row.status = RentalReservationStatus.Cancelled; });
    order.allocations.forEach((row) => { row.status = "released"; if (row.assetId) { const asset = state.assets.find((item) => item.id === row.assetId); if (asset) asset.status = RentalAssetStatus.Available; } });
    order.status = RentalCoreOrderStatus.Cancelled; order.updatedAt = now(); return order;
  }

  listInspectionTemplates(tenantId: string, stage?: "pickup" | "return") {
    return this.state(tenantId).inspectionTemplates.filter((row) => !stage || row.stage === stage);
  }
  listInspections(tenantId: string, orderId: string) {
    this.order(this.state(tenantId), orderId);
    return this.state(tenantId).inspections.filter((row) => row.orderId === orderId);
  }
  createInspection(tenantId: string, orderId: string, input: CreateRentalInspectionRequest, userName: string) {
    const state = this.state(tenantId); const order = this.order(state, orderId);
    const template = state.inspectionTemplates.find((row) => row.id === input.templateId && row.enabled);
    if (!template) throw new NotFoundException("检查模板不存在或已停用");
    const missing = template.fields.filter((field) => field.required && (input.results[field.code] === undefined || input.results[field.code] === ""));
    if (missing.length) throw new BadRequestException(`缺少必填检查项：${missing.map((field) => field.label).join("、")}`);
    if (template.stage === "pickup" && order.status !== RentalCoreOrderStatus.ReadyForPickup) throw new ConflictException("订单尚未完成配货，不能办理取件检查");
    if (template.stage === "return" && order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以办理归还检查");
    const record: RentalInspectionRecord = {
      id: id("inspection"), tenantId, orderId, stage: template.stage, templateId: template.id,
      templateCode: template.code, templateVersion: template.version, results: input.results,
      exceptions: input.exceptions ?? [], attachments: input.attachments ?? [], operator: input.operator || userName, createdAt: now()
    };
    state.inspections.unshift(record);
    if (template.stage === "pickup") {
      order.status = RentalCoreOrderStatus.Renting;
      order.reservations.forEach((row) => { row.status = RentalReservationStatus.Fulfilled; });
      order.allocations.forEach((row) => { row.status = "picked_up"; if (row.assetId) { const asset = state.assets.find((item) => item.id === row.assetId); if (asset) asset.status = RentalAssetStatus.Rented; } });
    } else {
      order.status = RentalCoreOrderStatus.Completed;
      order.reservations.forEach((row) => { row.status = RentalReservationStatus.Released; });
      order.allocations.forEach((row) => { row.status = "returned"; if (row.assetId) { const asset = state.assets.find((item) => item.id === row.assetId); if (asset) asset.status = RentalAssetStatus.Available; } });
    }
    order.updatedAt = now(); return { inspection: record, order };
  }

  private state(tenantId: string) {
    let state = this.states.get(tenantId);
    if (!state) { state = this.seedState(tenantId); this.states.set(tenantId, state); }
    return state;
  }
  private category(code: RentalCategoryCode) { const found = categories.find((row) => row.code === code); if (!found) throw new BadRequestException("未知经营品类"); return found; }
  private group(state: TenantRentalState, groupId: string) { const found = state.itemGroups.find((row) => row.id === groupId); if (!found) throw new NotFoundException("标的分组不存在"); return found; }
  private location(state: TenantRentalState, locationId: string) { const found = state.locations.find((row) => row.id === locationId); if (!found) throw new NotFoundException("履约网点不存在"); return found; }
  private order(state: TenantRentalState, orderId: string) { const found = state.orders.find((row) => row.id === orderId); if (!found) throw new NotFoundException("租赁订单不存在"); return found; }
  private validatePeriod(startAt: string, endAt: string) { const start = new Date(startAt).getTime(); const end = new Date(endAt).getTime(); if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new BadRequestException("租赁起止时间无效"); }
  private activeReservations(state: TenantRentalState, itemGroupId: string, locationId: string, startAt?: string, endAt?: string) {
    return state.orders.flatMap((order) => order.reservations.map((row) => ({ ...row, startAt: order.startAt, endAt: order.endAt }))).filter((row) => row.itemGroupId === itemGroupId && row.locationId === locationId && [RentalReservationStatus.Soft, RentalReservationStatus.Confirmed, RentalReservationStatus.Fulfilled].includes(row.status) && (!row.expiresAt || new Date(row.expiresAt).getTime() >= Date.now()) && (!startAt || !endAt || overlaps(row.startAt, row.endAt, startAt, endAt)));
  }
  private availableQuantity(state: TenantRentalState, group: RentalItemGroup, locationId: string, startAt: string, endAt: string, visited: Set<string>): number {
    if (visited.has(group.id)) throw new BadRequestException("检测到套装组成循环");
    if (group.status !== "enabled") return 0;
    if (group.inventoryMode === RentalInventoryMode.Serialized) {
      const total = state.assets.filter((row) => row.itemGroupId === group.id && row.locationId === locationId && ![RentalAssetStatus.Maintenance, RentalAssetStatus.Disabled].includes(row.status)).length;
      const reserved = this.activeReservations(state, group.id, locationId, startAt, endAt).reduce((sum, row) => sum + row.quantity, 0);
      return Math.max(0, total - reserved);
    }
    if (group.inventoryMode === RentalInventoryMode.Quantity) {
      const stock = state.stockBalances.find((row) => row.itemGroupId === group.id && row.locationId === locationId);
      const reserved = this.activeReservations(state, group.id, locationId, startAt, endAt).reduce((sum, row) => sum + row.quantity, 0);
      return Math.max(0, (stock?.onHandQuantity ?? 0) - (stock?.maintenanceQuantity ?? 0) - reserved);
    }
    const next = new Set(visited); next.add(group.id);
    const capacities = group.bundleComponents.filter((row) => !row.optional).map((component) => Math.floor(this.availableQuantity(state, this.group(state, component.itemGroupId), locationId, startAt, endAt, next) / component.quantity));
    return capacities.length ? Math.min(...capacities) : 0;
  }
  private resolveComponents(state: TenantRentalState, rows: SaveRentalItemGroupRequest["bundleComponents"], selfId?: string): RentalBundleComponent[] {
    return (rows ?? []).map((row) => {
      if (row.itemGroupId === selfId) throw new BadRequestException("套装不能包含自身");
      if (!Number.isInteger(row.quantity) || row.quantity <= 0) throw new BadRequestException("套装组成数量必须是正整数");
      const group = this.group(state, row.itemGroupId);
      if (group.inventoryMode === RentalInventoryMode.Bundle) throw new BadRequestException("v0.1 暂不支持嵌套套装");
      return { itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, quantity: row.quantity, optional: row.optional, substitutionGroup: row.substitutionGroup };
    });
  }

  private seedState(tenantId: string): TenantRentalState {
    const categoryCode = tenantId === "tenant_002" ? RentalCategoryCode.Camping : RentalCategoryCode.Camera;
    const isSampleTenant = tenantId === "tenant_001" || tenantId === "tenant_002";
    const definition = this.category(categoryCode); const timestamp = now(); const locationId = `${tenantId}_location_01`;
    const location: RentalFulfillmentLocation = { id: locationId, tenantId, code: "MAIN", name: categoryCode === RentalCategoryCode.Camera ? "中心器材门店" : "中心装备仓", type: "store", capabilities: ["pickup", "return", "storage", "delivery"], address: "演示地址 1 号", status: "enabled" };
    const base = (code: string, name: string, mode: RentalInventoryMode, unit: string, attributes: Record<string, unknown> = {}): RentalItemGroup => ({ id: `${tenantId}_${code.toLowerCase()}`, tenantId, categoryCode, code, name, inventoryMode: mode, unit, attributes, bundleComponents: [], status: "enabled", createdAt: timestamp, updatedAt: timestamp });
    const first = categoryCode === RentalCategoryCode.Camera ? base("CAM-BODY", "全画幅相机机身", RentalInventoryMode.Serialized, "台", { brand: "Sony", mount: "E" }) : base("CAMP-TENT", "四人露营帐篷", RentalInventoryMode.Quantity, "顶", { people: 4, season: "三季" });
    const second = categoryCode === RentalCategoryCode.Camera ? base("CAM-LENS", "24-70mm 标准镜头", RentalInventoryMode.Serialized, "支", { mount: "E" }) : base("CAMP-CHAIR", "折叠露营椅", RentalInventoryMode.Quantity, "把");
    const bundle = base(categoryCode === RentalCategoryCode.Camera ? "CAM-KIT" : "CAMP-KIT", categoryCode === RentalCategoryCode.Camera ? "标准拍摄套装" : "双人露营套装", RentalInventoryMode.Bundle, "套");
    bundle.bundleComponents = [first, second].map((row) => ({ itemGroupId: row.id, itemGroupCode: row.code, itemGroupName: row.name, quantity: row === second && categoryCode === RentalCategoryCode.Camping ? 2 : 1 }));
    const groups = isSampleTenant ? [first, second, bundle] : [];
    const assets: RentalAsset[] = isSampleTenant && categoryCode === RentalCategoryCode.Camera ? groups.filter((row) => row.inventoryMode === RentalInventoryMode.Serialized).flatMap((group, groupIndex) => Array.from({ length: 3 }, (_, index) => ({ id: `${group.id}_asset_${index + 1}`, tenantId, itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, assetNo: `${group.code}-${String(index + 1).padStart(3, "0")}`, serialNo: `SN${groupIndex + 1}${index + 1}0001`, locationId, locationName: location.name, status: RentalAssetStatus.Available, attributes: {}, createdAt: timestamp, updatedAt: timestamp }))) : [];
    const stocks: RentalStockBalance[] = isSampleTenant && categoryCode === RentalCategoryCode.Camping ? groups.filter((row) => row.inventoryMode === RentalInventoryMode.Quantity).map((group, index) => ({ id: `${group.id}_stock`, tenantId, itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, locationId, locationName: location.name, onHandQuantity: index === 0 ? 12 : 24, reservedQuantity: 0, maintenanceQuantity: index === 0 ? 1 : 2, availableQuantity: index === 0 ? 11 : 22, updatedAt: timestamp })) : [];
    const templates = this.buildInspectionTemplates(tenantId, categoryCode);
    return { profile: { tenantId, categoryCode, capabilities: [...definition.defaultCapabilities] as RentalCapability[], terminology: { ...definition.terminology }, configVersion: definition.version, initializedAt: timestamp, updatedAt: timestamp }, locations: [location], itemGroups: groups, assets, stockBalances: stocks, orders: [], inspectionTemplates: templates, inspections: [] };
  }

  private buildInspectionTemplates(tenantId: string, categoryCode: RentalCategoryCode): RentalInspectionTemplate[] {
    const definition = this.category(categoryCode);
    return (["pickup", "return"] as const).map((stage) => ({
      id: `${tenantId}_${stage}_template`, tenantId, categoryCode,
      code: `${categoryCode.toUpperCase()}_${stage.toUpperCase()}_V1`,
      name: `${stage === "pickup" ? definition.terminology.pickupLabel : definition.terminology.returnLabel}检查`,
      stage, version: "1.0", enabled: true,
      fields: categoryCode === RentalCategoryCode.Camera
        ? [{ code: "appearance_ok", label: "外观完好", type: "boolean", required: true }, { code: "function_ok", label: "功能正常", type: "boolean", required: true }, { code: "shutter_count", label: "快门次数", type: "number", required: true, unit: "次" }]
        : categoryCode === RentalCategoryCode.Camping
          ? [{ code: "count_ok", label: "数量齐全", type: "boolean", required: true }, { code: "cleanliness", label: "清洁状态", type: "select", required: true, options: ["良好", "需清洁", "严重污损"] }, { code: "damage_note", label: "破损说明", type: "text", required: false }]
          : [{ code: "appearance_ok", label: "外观完好", type: "boolean", required: true }, { code: "function_ok", label: "功能正常", type: "boolean", required: true }, { code: "usage_reading", label: definition.terminology.usageMetricLabel ?? "使用量", type: "number", required: false }]
    }));
  }
}

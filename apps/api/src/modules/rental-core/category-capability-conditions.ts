/** Core-owned conditional requirements and frozen evidence. Callers supply authorized catalog facts; this grants no access or writes. */
import { ConflictException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { requestFingerprint } from "./rental-idempotency.repository";
import {
  CATEGORY_PREPARATION_LIMITS, RENTAL_CAPABILITY_MODULES, RENTAL_CORE_CAPABILITY_CODES, RENTAL_FULFILLMENT_MODES, RentalInventoryMode,
  type RentalCapability, type RentalCapabilityRequirementSnapshot, type RentalCategoryDefinition,
  type RentalConditionalCapabilityRequirement, type RentalFulfillmentMode, type RentalItemGroup, type RentalQuoteRequest
} from "@rental-os/shared";

const MAX_REQUIREMENTS = 32, MAX_ITEMS = 1000;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const distinct = (value: unknown[]) => new Set(value).size === value.length;
const coreCodes = new Set<RentalCapability>(RENTAL_CORE_CAPABILITY_CODES);
const fail = (message: string): never => { throw new ConflictException(`品类条件不可执行：${message}`); };

/** Validate data grammar and scope, independently of whether the current process registered the executable Hook. */
export function validateConditionalCapabilities(definition: RentalCategoryDefinition): RentalConditionalCapabilityRequirement[] {
  const value: unknown = definition.conditionalCapabilities;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_REQUIREMENTS) return fail("条件能力数量或结构无效");
  const codes = new Set<string>();
  for (const entry of value) {
    if (!object(entry) || !keys(entry, ["code", "when"]) || typeof entry.code !== "string" || !object(entry.when)) return fail("条件能力结构无效");
    const module = RENTAL_CAPABILITY_MODULES.find(module => module.code === entry.code);
    if (!module || !module.implementationVersion || coreCodes.has(module.code)) return fail("条件必选只适用于已实现的独立扩展；基础能力继续由经营规则控制");
    if (!definition.defaultCapabilities.includes(module.code) || definition.requiredCapabilities.includes(module.code) || codes.has(module.code)) return fail("条件能力须单独声明，不能重复或同时设为空间必需");
    if (module.applicableCategories !== "all" && !module.applicableCategories.includes(definition.code)) return fail(`能力 ${module.label} 不适用于本品类`);
    codes.add(module.code);
    const condition = entry.when;
    if (!Object.keys(condition).length || !keys(condition, ["inventoryModes", "fulfillmentModes", "itemAttribute"])) return fail("只支持库存形态、履约方式和商品分类属性条件");
    for (const [key, allowed] of [["inventoryModes", definition.supportedInventoryModes], ["fulfillmentModes", definition.businessModel.fulfillmentModes]] as const) {
      if (!owns(condition, key)) continue;
      const choices = condition[key];
      if (!strings(choices) || !choices.length || !distinct(choices) || choices.some(choice => !(allowed as readonly string[]).includes(choice))) return fail(`${key} 条件必须是品类支持范围的非空子集`);
    }
    if (owns(condition, "itemAttribute")) {
      const attribute = condition.itemAttribute;
      if (!object(attribute) || !keys(attribute, ["code", "values"]) || typeof attribute.code !== "string" ||
          !/^[A-Za-z][A-Za-z0-9_]{0,63}(?![\s\S])/u.test(attribute.code) || ["constructor", "prototype", "__proto__"].includes(attribute.code) ||
          !Array.isArray(attribute.values) || !attribute.values.length || attribute.values.length > 100 || !distinct(attribute.values)) return fail("商品分类属性条件无效");
      const field = definition.businessModel.assetFields.find(field => field.scope === "item_group" && field.code === attribute.code);
      if (!field || !["select", "boolean"].includes(field.type)) return fail("条件只能选择已声明的型号枚举或布尔属性");
      if (attribute.values.some(value => field.type === "boolean" ? typeof value !== "boolean" : typeof value !== "string" || !field.options?.includes(value))) return fail(`属性 ${field.label} 的条件值不在允许范围内`);
    }
  }
  return value as RentalConditionalCapabilityRequirement[];
}

type CatalogGroup = Pick<RentalItemGroup, "id" | "inventoryMode" | "attributes"> & {
  bundleComponents: Array<Pick<RentalItemGroup["bundleComponents"][number], "itemGroupId" | "optional">>;
};
type Fact = RentalCapabilityRequirementSnapshot["items"][number];

/** Core's pricing-group resolver owns these member snapshots. An unresolved group is not an exact-model booking. */
export function capabilityRequirementRoots(lines: ReadonlyArray<Pick<RentalQuoteRequest["lines"][number],
  "itemGroupId" | "pricingGroupId" | "reservationPrecision" | "pricingGroupMemberItemGroupIds">>): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (line.pricingGroupId && line.reservationPrecision !== "exact_model") {
      if (!strings(line.pricingGroupMemberItemGroupIds) || !line.pricingGroupMemberItemGroupIds.length) return fail("按组预约缺少服务端固化的型号范围");
      result.push(...line.pricingGroupMemberItemGroupIds);
    } else {
      if (!line.itemGroupId || line.reservationPrecision === "group") return fail("报价缺少明确的商品范围");
      result.push(line.itemGroupId);
    }
  }
  return [...new Set(result)].sort();
}

function policyHash(definition: RentalCategoryDefinition) {
  // Array order belongs to the immutable definition. It does not control Hook execution order.
  return requestFingerprint(definition.conditionalCapabilities ?? []);
}

function reachable(items: Map<string, Fact>, roots: readonly string[]): Fact[] {
  const selected = new Map<string, Fact>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) return fail("套装组成存在循环");
    if (selected.has(id)) return;
    const row = items.get(id);
    if (!row) return fail("商品或套装组成的历史依据缺失");
    visiting.add(id);
    row.componentItemGroupIds.forEach(visit);
    visiting.delete(id);
    selected.set(id, row);
    if (selected.size > MAX_ITEMS) fail("条件涉及的商品数量超过支持上限");
  };
  roots.forEach(visit);
  return [...selected.values()].sort((a, b) => a.itemGroupId < b.itemGroupId ? -1 : a.itemGroupId > b.itemGroupId ? 1 : 0);
}

function matches(definition: RentalCategoryDefinition, items: Fact[], fulfillmentMode: RentalFulfillmentMode) {
  return validateConditionalCapabilities(definition).map(requirement => ({
    code: requirement.code,
    itemGroupIds: items.filter(item => {
      const condition = requirement.when;
      // A known false conjunct makes unrelated, unclassified products irrelevant to this requirement.
      if (condition.fulfillmentModes && !condition.fulfillmentModes.includes(fulfillmentMode)) return false;
      if (condition.inventoryModes && !condition.inventoryModes.includes(item.inventoryMode)) return false;
      if (!condition.itemAttribute) return true;
      const field = definition.businessModel.assetFields.find(field => field.scope === "item_group" && field.code === condition.itemAttribute!.code)!;
      const value = item.attributes[field.code];
      if (!owns(item.attributes, field.code) || (field.type === "boolean" ? typeof value !== "boolean" : typeof value !== "string" || !field.options?.includes(value))) {
        return fail(`商品 ${item.itemGroupId} 缺少有效的“${field.label}”分类依据，不能当作未触发`);
      }
      return condition.itemAttribute.values.includes(value);
    }).map(item => item.itemGroupId)
  }));
}

/** Whole-space adoption readiness uses current scoped facts, not a booking or
 * a historical snapshot. It shares the condition matcher while retaining the
 * separate collection limit; the 1000-item quote/fulfillment limit stays intact. */
export function workspaceCapabilityRequirements(
  definition: RentalCategoryDefinition,
  groups: ReadonlyArray<{ id: string; inventoryMode: string; attributes?: unknown }>,
  fulfillmentModes: unknown
) {
  const requirements = validateConditionalCapabilities(definition);
  const required = new Set<RentalCapability>(definition.requiredCapabilities);
  const evaluated: Array<{ code: RentalCapability; fulfillmentMode: RentalFulfillmentMode; itemGroupIds: string[] }> = [];
  if (!requirements.length) return { required: [...required].sort(), matches: evaluated, checkedItemGroupCount: 0 };
  if (groups.length > CATEGORY_PREPARATION_LIMITS.collectionEntities) return fail("条件采用涉及的型号超过准备集合支持上限");
  if (!strings(fulfillmentModes) || !fulfillmentModes.length || !distinct(fulfillmentModes) ||
    fulfillmentModes.some(mode => !(definition.businessModel.fulfillmentModes as readonly string[]).includes(mode))) return fail("条件采用缺少合法的当前履约配置");
  const fields = new Set(requirements.flatMap(row => row.when.itemAttribute ? [row.when.itemAttribute.code] : []));
  const ids = new Set<string>();
  const facts: Fact[] = groups.map(group => {
    const mode = group.inventoryMode.toLowerCase() as RentalInventoryMode;
    if (!group.id || ids.has(group.id) || !Object.values(RentalInventoryMode).includes(mode) || !object(group.attributes)) return fail("条件采用的实际型号资料不完整或身份重复");
    ids.add(group.id);
    const attributes: Fact["attributes"] = {};
    for (const code of fields) {
      const value = group.attributes[code];
      if (owns(group.attributes, code) && (typeof value === "string" || typeof value === "boolean")) attributes[code] = value;
    }
    // All same-space models are checked, including models used as components.
    // Product-graph validation owns missing/cyclic component references.
    return { itemGroupId: group.id, inventoryMode: mode, attributes, componentItemGroupIds: [] };
  });
  for (const mode of fulfillmentModes) {
    for (const match of matches(definition, facts, mode as RentalFulfillmentMode)) {
      evaluated.push({ ...match, fulfillmentMode: mode as RentalFulfillmentMode });
      if (match.itemGroupIds.length) required.add(match.code);
    }
  }
  return { required: [...required].sort(), matches: evaluated, checkedItemGroupCount: facts.length };
}

/** Capture only immutable inputs used by these rules, including required bundle components. No caller-supplied match flags are accepted. */
export function captureCapabilityRequirements(
  definition: RentalCategoryDefinition, groups: readonly CatalogGroup[], rootItemGroupIds: readonly string[], fulfillmentMode: RentalFulfillmentMode
): RentalCapabilityRequirementSnapshot | undefined {
  const requirements = validateConditionalCapabilities(definition);
  if (!requirements.length) return undefined;
  if (!RENTAL_FULFILLMENT_MODES.includes(fulfillmentMode) || !definition.businessModel.fulfillmentModes.includes(fulfillmentMode)) return fail("缺少合法的实际履约方式");
  if (!rootItemGroupIds.length || rootItemGroupIds.length > MAX_ITEMS || !strings(rootItemGroupIds) || rootItemGroupIds.some(id => !id.trim() || id.length > 191)) return fail("实际商品范围无效");
  const fields = new Set(requirements.flatMap(row => row.when.itemAttribute ? [row.when.itemAttribute.code] : []));
  const catalog = new Map(groups.map(group => [group.id, group]));
  if (catalog.size !== groups.length) return fail("商品资料存在重复身份");
  const facts = new Map<string, Fact>();
  const visiting = new Set<string>();
  const collect = (id: string) => {
    if (visiting.has(id)) return fail("套装组成存在循环");
    if (facts.has(id)) return;
    const group = catalog.get(id);
    if (!group || !Object.values(RentalInventoryMode).includes(group.inventoryMode) || !object(group.attributes)) return fail("实际商品资料不完整");
    if (facts.size >= MAX_ITEMS) return fail("条件涉及的商品数量超过支持上限");
    visiting.add(id);
    const components = group.inventoryMode === RentalInventoryMode.Bundle
      ? (group.bundleComponents ?? []).filter(component => !component.optional).map(component => component.itemGroupId) : [];
    if (!distinct(components)) return fail("套装组成重复");
    const attributes: Fact["attributes"] = {};
    for (const key of fields) {
      const value = group.attributes[key];
      if (owns(group.attributes, key) && (typeof value === "string" || typeof value === "boolean")) attributes[key] = value;
    }
    // Insert before descending to bound work; visiting still rejects a back edge.
    facts.set(id, { itemGroupId: id, inventoryMode: group.inventoryMode, attributes, componentItemGroupIds: [...components].sort() });
    components.forEach(collect);
    visiting.delete(id);
  };
  const roots = [...new Set(rootItemGroupIds)].sort();
  roots.forEach(collect);
  const items = reachable(facts, roots);
  return { structureVersion: 1, categoryCode: definition.code, definitionVersion: definition.version,
    policyHash: policyHash(definition), fulfillmentMode, rootItemGroupIds: roots, items, matches: matches(definition, items, fulfillmentMode) };
}

/** Replay the stored facts under the referenced policy. Active roots may only remove Core-confirmed cancelled lines, never introduce new products. */
export function resolveCapabilityRequirements(
  definition: RentalCategoryDefinition, value: unknown, activeRootItemGroupIds?: readonly string[]
): { required: RentalCapability[]; inactive: RentalCapability[] } {
  const requirements = validateConditionalCapabilities(definition);
  if (!requirements.length) return { required: [...definition.requiredCapabilities], inactive: [] };
  if (!object(value) || !keys(value, ["structureVersion", "categoryCode", "definitionVersion", "policyHash", "fulfillmentMode", "rootItemGroupIds", "items", "matches"]) ||
      value.structureVersion !== 1 || value.categoryCode !== definition.code || value.definitionVersion !== definition.version || value.policyHash !== policyHash(definition) ||
      typeof value.fulfillmentMode !== "string" || !(definition.businessModel.fulfillmentModes as readonly string[]).includes(value.fulfillmentMode) ||
      !strings(value.rootItemGroupIds) || !value.rootItemGroupIds.length || value.rootItemGroupIds.length > MAX_ITEMS || !distinct(value.rootItemGroupIds) ||
      !Array.isArray(value.items) || !value.items.length || value.items.length > MAX_ITEMS || !Array.isArray(value.matches)) return fail("条件执行快照缺失或与引用版本不一致");
  const fields = new Set(requirements.flatMap(row => row.when.itemAttribute ? [row.when.itemAttribute.code] : []));
  for (const item of value.items) {
    if (!object(item) || !keys(item, ["itemGroupId", "inventoryMode", "attributes", "componentItemGroupIds"]) ||
        typeof item.itemGroupId !== "string" || !item.itemGroupId.trim() || item.itemGroupId.length > 191 ||
        !(Object.values(RentalInventoryMode) as unknown[]).includes(item.inventoryMode) || !object(item.attributes) ||
        Object.entries(item.attributes).some(([key, value]) => !fields.has(key) || (typeof value !== "string" && typeof value !== "boolean")) ||
        !strings(item.componentItemGroupIds) || item.componentItemGroupIds.length > MAX_ITEMS || !distinct(item.componentItemGroupIds) ||
        (item.inventoryMode !== RentalInventoryMode.Bundle && item.componentItemGroupIds.length)) return fail("条件商品快照结构无效");
  }
  const snapshot = value as unknown as RentalCapabilityRequirementSnapshot;
  const facts = new Map(snapshot.items.map(item => [item.itemGroupId, item]));
  if (facts.size !== snapshot.items.length) return fail("条件商品快照身份重复");
  const original = reachable(facts, snapshot.rootItemGroupIds);
  if (original.length !== facts.size || !isDeepStrictEqual(matches(definition, original, snapshot.fulfillmentMode), snapshot.matches)) return fail("条件结果与原商品依据不一致");
  const roots = activeRootItemGroupIds ? [...new Set(activeRootItemGroupIds)] : snapshot.rootItemGroupIds;
  if (roots.some(id => !snapshot.rootItemGroupIds.includes(id))) return fail("新增或替换商品必须保存该动作自己的条件依据");
  const current = matches(definition, reachable(facts, roots), snapshot.fulfillmentMode);
  return { required: [...new Set([...definition.requiredCapabilities, ...current.filter(row => row.itemGroupIds.length).map(row => row.code)])],
    inactive: current.filter(row => !row.itemGroupIds.length).map(row => row.code) };
}

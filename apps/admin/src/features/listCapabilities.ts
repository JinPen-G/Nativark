/** Page eligibility and exact payloads for optional list tools. Original APIs remain the only write path. */
import { RentalInventoryMode, type RentalAttributeDefinition, type RentalItemGroup, type RentalFulfillmentLocation, type RentalFulfillmentOperator, type SaveRentalItemGroupRequest, type SaveRentalFulfillmentLocationRequest, type SaveRentalFulfillmentOperatorRequest, type CustomerMembershipPlan, type RegisterPersonalMembershipRequest, type SaveCorporateMembershipRequest } from "@rental-os/shared";
import { rentalCoreApi } from "@/api/rentalCore";
import { membershipApi } from "@/api/membership";
import { useAuthStore } from "@/features/auth/authStore";
import { defineListImport, type ListBatchAction, type ListExport } from "@/components/ui";
import { ListPreflightError } from "@/components/ui/data-table/listTransfer";

type Translator = (key: string) => string;
type Complete = () => Promise<unknown>;
const permitted = (permission: string) => () => useAuthStore.getState().hasPermission(permission);
function required(value: string | undefined, label: string) { if (!value?.trim()) throw new Error(label); return value.trim(); }
function choice<const T extends string>(value: string, choices: readonly T[]): T { if (!choices.includes(value as T)) throw new Error(`${value}: ${choices.join(" / ")}`); return value as T; }
/** Only known duplicate conflicts are skipped. Validation, permission and unknown errors remain failures. */
async function createOnly(operation: () => Promise<unknown>, duplicates: string[]) {
  try { return await operation(); }
  catch (error) {
    const response = (error as { response?: { status?: number; data?: { message?: unknown } } }).response;
    if (response?.status === 409 && typeof response.data?.message === "string" && duplicates.includes(response.data.message)) return { skipped: true };
    throw error;
  }
}
export function personalImport(t: Translator, onComplete: Complete, supported: boolean) {
  const allowed = () => useAuthStore.getState().hasTenantMembershipPermission("rental-os:member:manage");
  return supported && allowed() ? defineListImport<RegisterPersonalMembershipRequest>({ filename: t("个人会员模板"), fields: [{ key: "name", label: "姓名", required: true }, { key: "phone", label: "手机号", required: true }, { key: "email", label: "邮箱" }],
    parse: value => {
      const name = required(value.name, "姓名"), phone = required(value.phone, "手机号");
      if (name.length > 120 || phone.length > 40 || !/^\+?\d{6,40}$/.test(phone)) throw new Error("姓名或手机号格式错误");
      if (value.email && (value.email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))) throw new Error("邮箱格式错误");
      return { name, phone, email: value.email || undefined, channel: "admin", onlyNew: true, idempotencyKey: crypto.randomUUID() };
    }, key: row => row.phone,
    // Public member lists mask phones. Duplicate resolution stays server-side; never reveal phones to compare.
    existingKeys: async () => [], create: membershipApi.registerPersonal, allowed, onComplete,
  }) : undefined;
}
export function corporateImport(t: Translator, onComplete: Complete) {
  const allowed = () => useAuthStore.getState().hasTenantMembershipPermission("rental-os:corporate:manage");
  return allowed() ? defineListImport<SaveCorporateMembershipRequest>({ filename: t("企业会员模板"), fields: [{ key: "corporateName", label: "企业名称", required: true }, { key: "name", label: "联系人", required: true }, { key: "phone", label: "联系电话", required: true }, { key: "unifiedSocialCreditCode", label: "统一社会信用代码", required: true }, { key: "email", label: "邮箱" }, { key: "registeredAddress", label: "注册地址" }],
    parse: value => {
      const code = required(value.unifiedSocialCreditCode, "统一社会信用代码").toUpperCase();
      if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(code)) throw new Error("统一社会信用代码必须为 18 位有效字符");
      const name = required(value.name, "联系人"), phone = required(value.phone, "联系电话"), corporateName = required(value.corporateName, "企业名称");
      if (name.length > 120 || corporateName.length > 200 || !/^\+?\d{6,40}$/.test(phone)) throw new Error("姓名或手机号格式错误");
      if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) throw new Error("邮箱格式错误");
      return { name, phone, corporateName, unifiedSocialCreditCode: code, email: value.email || undefined, registeredAddress: value.registeredAddress || undefined };
    }, key: row => row.unifiedSocialCreditCode!, existingKeys: async () => [], allowed, onComplete,
    create: value => createOnly(() => membershipApi.saveCorporate(value), ["该手机号已被其他客户主档使用", "该统一社会信用代码已登记为本租户的其他企业"]),
  }) : undefined;
}
function statusActions<T extends { id: string; status: string; updatedAt?: string }>(permission: string, read: () => Promise<T[]>, save: (row: T, status: "enabled" | "disabled") => Promise<unknown>, onComplete: Complete): ListBatchAction<T>[] {
  return (["enabled", "disabled"] as const).map(status => ({ key: status, label: status === "enabled" ? "批量启用" : "批量停用", danger: status === "disabled", allowed: permitted(permission), eligible: row => row.status !== status,
    run: async row => {
      const current = (await read()).find(item => item.id === row.id);
      if (!current || current.updatedAt && row.updatedAt && current.updatedAt !== row.updatedAt) throw new ListPreflightError("资料已变更，请刷新后重新选择");
      if (!permitted(permission)()) throw new ListPreflightError("当前操作不可用");
      if (current.status !== status) return save(current, status);
    }, onComplete,
  }));
}

export function catalogCapabilities(t: Translator, fields: RentalAttributeDefinition[], onComplete: Complete, modes: RentalInventoryMode[], fixedMode?: RentalInventoryMode, fixedUnit?: string) {
  const allowed = permitted("rental-core:catalog:manage");
  const exportConfig: ListExport<RentalItemGroup> = { filename: t("商品目录"), fields: [
    { label: t("编码"), value: row => row.code }, { label: t("名称"), value: row => row.name }, { label: t("库存模式"), value: row => row.inventoryMode }, { label: t("单位"), value: row => row.unit }, { label: t("状态"), value: row => t(row.status === "enabled" ? "已启用" : "已停用") },
    ...fields.map(field => ({ label: t(field.label), value: (row: RentalItemGroup) => row.attributes[field.code] == null ? "" : String(row.attributes[field.code]) })),
  ] };
  const importConfig = allowed() ? defineListImport<SaveRentalItemGroupRequest>({ filename: t("商品目录模板"), fields: [
    { key: "code", label: "编码", required: true }, { key: "name", label: "名称", required: true }, { key: "inventoryMode", label: "库存模式", required: !fixedMode, example: (fixedMode ? [fixedMode] : modes.filter(mode => mode !== RentalInventoryMode.Bundle)).join(" / ") }, { key: "unit", label: "单位" }, { key: "description", label: "说明" },
    ...fields.map(field => ({ key: `attr.${field.code}`, label: field.label, required: field.required, example: field.options?.join(" / ") })),
  ], parse: values => {
    const attributes: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[`attr.${field.code}`];
      if (!value) { if (field.required) throw new Error(`${field.label}: 必填`); continue; }
      if (field.type === "number") { if (!Number.isFinite(Number(value))) throw new Error(`${field.label}: 请输入数字`); attributes[field.code] = Number(value); }
      else if (field.type === "boolean") attributes[field.code] = choice(value, ["true", "false"]) === "true";
      else { if (field.options?.length && !field.options.includes(value)) throw new Error(`${field.label}: ${field.options.join(" / ")}`); attributes[field.code] = value; }
    }
    const inventoryMode = choice(fixedMode ?? values.inventoryMode, modes.filter(mode => mode !== RentalInventoryMode.Bundle));
    return { code: required(values.code, "编码"), name: required(values.name, "名称"), inventoryMode, unit: fixedUnit || values.unit || undefined, description: values.description || undefined, attributes, status: "enabled" };
  }, key: value => value.code, existingKeys: async () => (await rentalCoreApi.itemGroups()).map(row => row.code), create: value => createOnly(() => rentalCoreApi.saveItemGroup(value), ["标的编码已存在"]), allowed, onComplete }) : undefined;
  const batchActions = allowed() ? statusActions("rental-core:catalog:manage", rentalCoreApi.itemGroups, (row, status) => rentalCoreApi.saveItemGroup({ id: row.id, code: row.code, name: row.name, inventoryMode: row.inventoryMode, unit: row.unit, description: row.description,
    attributes: Object.fromEntries(fields.filter(field => Object.hasOwn(row.attributes, field.code)).map(field => [field.code, row.attributes[field.code]])),
    bundleComponents: row.bundleComponents?.map(item => ({ itemGroupId: item.itemGroupId, quantity: item.quantity, optional: item.optional, substitutionGroup: item.substitutionGroup })), status }), onComplete) : [];
  return { exportConfig, importConfig, batchActions };
}

export function operatorCapabilities(t: Translator, onComplete: Complete) {
  const allowed = permitted("rental-os:station:manage");
  return {
    exportConfig: { filename: t("经营主体"), fields: [{ label: t("编码"), value: (row: RentalFulfillmentOperator) => row.code }, { label: t("名称"), value: (row: RentalFulfillmentOperator) => row.name }, { label: t("经营方式"), value: (row: RentalFulfillmentOperator) => t(row.type === "partner" ? "合作商" : "自营") }, { label: t("结算方式"), value: (row: RentalFulfillmentOperator) => row.settlementMode }, { label: t("状态"), value: (row: RentalFulfillmentOperator) => t(row.status === "enabled" ? "已启用" : "已停用") }] },
    importConfig: allowed() ? defineListImport<SaveRentalFulfillmentOperatorRequest>({ filename: t("经营主体模板"), fields: [{ key: "code", label: "编码", required: true }, { key: "name", label: "名称", required: true }, { key: "type", label: "经营方式", required: true, example: "self_operated / partner" }, { key: "settlementMode", label: "结算方式", required: true, example: "self / monthly / per_order" }],
      parse: value => ({ code: required(value.code, "编码"), name: required(value.name, "名称"), type: choice(value.type, ["self_operated", "partner"]), settlementMode: choice(value.settlementMode, ["self", "monthly", "per_order"]), status: "enabled" }), key: row => row.code, existingKeys: async () => (await rentalCoreApi.operators()).map(row => row.code), create: value => createOnly(() => rentalCoreApi.saveOperator(value), ["经营主体编码已存在"]), allowed, onComplete }) : undefined,
    batchActions: allowed() ? statusActions("rental-os:station:manage", rentalCoreApi.operators, (row, status) => rentalCoreApi.saveOperator({ id: row.id, code: row.code, name: row.name, type: row.type, settlementMode: row.settlementMode, contactName: row.contactName, contactPhone: row.contactPhone, status }), onComplete) : [],
  };
}

export function locationCapabilities(t: Translator, locationTypes: string[], onComplete: Complete) {
  const allowed = permitted("rental-os:station:manage");
  return {
    exportConfig: { filename: t("履约地点"), fields: [{ label: t("编码"), value: (row: RentalFulfillmentLocation) => row.code }, { label: t("名称"), value: (row: RentalFulfillmentLocation) => row.name }, { label: t("经营主体"), value: (row: RentalFulfillmentLocation) => row.operatorName }, { label: t("地点类型"), value: (row: RentalFulfillmentLocation) => row.type }, { label: t("地址"), value: (row: RentalFulfillmentLocation) => row.address }, { label: t("状态"), value: (row: RentalFulfillmentLocation) => t(row.status === "enabled" ? "已启用" : "已停用") }] },
    importConfig: allowed() ? defineListImport<SaveRentalFulfillmentLocationRequest>({ filename: t("履约地点模板"), fields: [{ key: "code", label: "编码", required: true }, { key: "name", label: "名称", required: true }, { key: "type", label: "地点类型", required: true, example: locationTypes.join(" / ") }, { key: "operatorCode", label: "经营主体编码", required: true }, { key: "capabilities", label: "履约能力", required: true, example: "pickup|return|storage|delivery" }, { key: "address", label: "地址" }],
      parse: value => {
        const type = choice(value.type, ["store", "warehouse", "station", "locker", "delivery_hub", "project_site"]);
        if (!locationTypes.includes(type)) throw new Error("当前品类不支持该地点类型");
        return { code: required(value.code, "编码"), name: required(value.name, "名称"), type, operatorId: required(value.operatorCode, "经营主体编码"), capabilities: value.capabilities.split("|").map(item => choice(item.trim(), ["pickup", "return", "storage", "delivery"])), address: value.address || undefined, timezone: "Asia/Shanghai", status: "enabled" };
      }, key: row => row.code, existingKeys: async () => (await rentalCoreApi.locations()).map(row => row.code), create: async value => {
        // Template refers to readable operator codes. Resolve them without auto-creating an operator.
        const operator = (await rentalCoreApi.operators()).find(row => row.code === value.operatorId && row.status === "enabled");
        if (!operator) throw new ListPreflightError("经营主体不存在或已停用");
        if (!allowed()) throw new ListPreflightError("当前操作不可用");
        return createOnly(() => rentalCoreApi.saveLocation({ ...value, operatorId: operator.id }), ["履约地点编码已存在"]);
      }, allowed, onComplete }) : undefined,
    batchActions: allowed() ? statusActions("rental-os:station:manage", rentalCoreApi.locations, (row, status) => rentalCoreApi.saveLocation({ id: row.id, code: row.code, name: row.name, type: row.type, organizationId: row.organizationId, operatorId: row.operatorId, parentLocationId: row.parentLocationId, capabilities: row.capabilities, address: row.address, province: row.province, city: row.city, district: row.district, timezone: row.timezone, latitude: row.latitude, longitude: row.longitude, contactName: row.contactName, contactPhone: row.contactPhone, businessHours: row.businessHours, status }), onComplete) : [],
  };
}

export function planBatchActions(onComplete: Complete): ListBatchAction<CustomerMembershipPlan>[] {
  const allowed = () => useAuthStore.getState().hasTenantMembershipPermission("rental-os:member:plan:publish");
  return allowed() ? [{ key: "disable", label: "批量停用", danger: true, reason: true, allowed, eligible: row => row.currentVersion?.status === "published",
    run: async (row, reason) => {
      const current = (await membershipApi.plans()).find(item => item.id === row.id);
      if (!allowed() || !current?.currentVersion || current.currentVersion.id !== row.currentVersion?.id || current.currentVersion.status !== "published") throw new ListPreflightError("方案版本已变更，请刷新后重新选择");
      return membershipApi.disablePlan(current.id, current.currentVersion.id, reason);
    }, onComplete }] : [];
}

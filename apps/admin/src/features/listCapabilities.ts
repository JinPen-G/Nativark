/** Page eligibility and exact payloads for optional list tools. Original APIs remain the only write path. */
import { RentalInventoryMode, type RentalAttributeDefinition, type CustomerMembershipPlan, type RegisterPersonalMembershipRequest, type SaveCorporateMembershipRequest } from "@rental-os/shared";
import { rentalCoreApi } from "@/api/rentalCore";
import { locationCapabilities as createLocationCapabilities, operatorCapabilities as createOperatorCapabilities }
  from "@rental-os/rental-core/admin/locations/list-capabilities";
import { catalogCapabilities as createCatalogCapabilities } from "@rental-os/rental-core/admin/catalog/list-capabilities";
import { membershipApi } from "@/api/membership";
import { useAuthStore } from "@/features/auth/authStore";
import { defineListImport, type ListBatchAction } from "@/components/ui";
import { ListPreflightError } from "@/components/ui/data-table/listTransfer";

type Translator = (key: string) => string;
type Complete = () => Promise<unknown>;
const permitted = (permission: string) => () => useAuthStore.getState().hasPermission(permission);
function required(value: string | undefined, label: string) { if (!value?.trim()) throw new Error(label); return value.trim(); }

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


export function catalogCapabilities(
  t: Translator,
  fields: RentalAttributeDefinition[],
  onComplete: Complete,
  modes: RentalInventoryMode[],
  fixedMode?: RentalInventoryMode,
  fixedUnit?: string,
) {
  return createCatalogCapabilities(
    t,
    fields,
    onComplete,
    { api: rentalCoreApi, allowed: permitted("rental-core:catalog:manage") },
    modes,
    fixedMode,
    fixedUnit,
  );
}

export function operatorCapabilities(t: Translator, onComplete: Complete) {
  return createOperatorCapabilities(t, onComplete, { api: rentalCoreApi, allowed: permitted("rental-os:station:manage") });
}

export function locationCapabilities(t: Translator, locationTypes: string[], onComplete: Complete) {
  return createLocationCapabilities(t, locationTypes, onComplete, { api: rentalCoreApi, allowed: permitted("rental-os:station:manage") });
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

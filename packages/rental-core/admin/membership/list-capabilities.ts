/** 会员导入与方案批量停用沿原校验、当前租户权限和原服务端请求执行。 */
import type {
  CustomerMembershipPlan,
  RegisterPersonalMembershipRequest,
  SaveCorporateMembershipRequest,
} from "@rental-os/rental-core";
import {
  defineListImport,
  type ListBatchAction,
} from "@rental-os/platform-admin/ui";
import { ListPreflightError } from "@rental-os/platform-admin/source/components/ui/data-table/listTransfer";
import type { RentalMembershipApi } from "./client";
import type { RentalMembershipSession } from "./page-context";
type Translator = (key: string) => string;
type Complete = () => Promise<unknown>;
export interface RentalMembershipListDependencies {
  api: RentalMembershipApi;
  getSession: () => Pick<
    RentalMembershipSession,
    "hasTenantMembershipPermission"
  >;
}
function required(value: string | undefined, label: string) {
  if (!value?.trim()) throw new Error(label);
  return value.trim();
}

async function createOnly(
  operation: () => Promise<unknown>,
  duplicates: string[],
) {
  try {
    return await operation();
  } catch (error) {
    const response = (
      error as { response?: { status?: number; data?: { message?: unknown } } }
    ).response;
    if (
      response?.status === 409 &&
      typeof response.data?.message === "string" &&
      duplicates.includes(response.data.message)
    )
      return { skipped: true };
    throw error;
  }
}

export function personalImport(
  t: Translator,
  onComplete: Complete,
  supported: boolean,
  dependencies: RentalMembershipListDependencies,
) {
  const membershipApi = dependencies.api;
  const allowed = () =>
    dependencies
      .getSession()
      .hasTenantMembershipPermission("rental-os:member:manage");
  return supported && allowed()
    ? defineListImport<RegisterPersonalMembershipRequest>({
        filename: t("个人会员模板"),
        fields: [
          { key: "name", label: "姓名", required: true },
          { key: "phone", label: "手机号", required: true },
          { key: "email", label: "邮箱" },
        ],
        parse: (value) => {
          const name = required(value.name, "姓名"),
            phone = required(value.phone, "手机号");
          if (
            name.length > 120 ||
            phone.length > 40 ||
            !/^\+?\d{6,40}$/.test(phone)
          )
            throw new Error("姓名或手机号格式错误");
          if (
            value.email &&
            (value.email.length > 160 ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
          )
            throw new Error("邮箱格式错误");
          return {
            name,
            phone,
            email: value.email || undefined,
            channel: "admin",
            onlyNew: true,
            idempotencyKey: crypto.randomUUID(),
          };
        },
        key: (row) => row.phone,
        // Public member lists mask phones. Duplicate resolution stays server-side; never reveal phones to compare.
        existingKeys: async () => [],
        create: membershipApi.registerPersonal,
        allowed,
        onComplete,
      })
    : undefined;
}

export function corporateImport(
  t: Translator,
  onComplete: Complete,
  dependencies: RentalMembershipListDependencies,
) {
  const membershipApi = dependencies.api;
  const allowed = () =>
    dependencies
      .getSession()
      .hasTenantMembershipPermission("rental-os:corporate:manage");
  return allowed()
    ? defineListImport<SaveCorporateMembershipRequest>({
        filename: t("企业会员模板"),
        fields: [
          { key: "corporateName", label: "企业名称", required: true },
          { key: "name", label: "联系人", required: true },
          { key: "phone", label: "联系电话", required: true },
          {
            key: "unifiedSocialCreditCode",
            label: "统一社会信用代码",
            required: true,
          },
          { key: "email", label: "邮箱" },
          { key: "registeredAddress", label: "注册地址" },
        ],
        parse: (value) => {
          const code = required(
            value.unifiedSocialCreditCode,
            "统一社会信用代码",
          ).toUpperCase();
          if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(code))
            throw new Error("统一社会信用代码必须为 18 位有效字符");
          const name = required(value.name, "联系人"),
            phone = required(value.phone, "联系电话"),
            corporateName = required(value.corporateName, "企业名称");
          if (
            name.length > 120 ||
            corporateName.length > 200 ||
            !/^\+?\d{6,40}$/.test(phone)
          )
            throw new Error("姓名或手机号格式错误");
          if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
            throw new Error("邮箱格式错误");
          return {
            name,
            phone,
            corporateName,
            unifiedSocialCreditCode: code,
            email: value.email || undefined,
            registeredAddress: value.registeredAddress || undefined,
          };
        },
        key: (row) => row.unifiedSocialCreditCode!,
        existingKeys: async () => [],
        allowed,
        onComplete,
        create: (value) =>
          createOnly(
            () => membershipApi.saveCorporate(value),
            [
              "该手机号已被其他客户主档使用",
              "该统一社会信用代码已登记为本租户的其他企业",
            ],
          ),
      })
    : undefined;
}

export function planBatchActions(
  onComplete: Complete,
  dependencies: RentalMembershipListDependencies,
): ListBatchAction<CustomerMembershipPlan>[] {
  const membershipApi = dependencies.api;
  const allowed = () =>
    dependencies
      .getSession()
      .hasTenantMembershipPermission("rental-os:member:plan:publish");
  return allowed()
    ? [
        {
          key: "disable",
          label: "批量停用",
          danger: true,
          reason: true,
          allowed,
          eligible: (row) => row.currentVersion?.status === "published",
          run: async (row, reason) => {
            const current = (await membershipApi.plans()).find(
              (item) => item.id === row.id,
            );
            if (
              !allowed() ||
              !current?.currentVersion ||
              current.currentVersion.id !== row.currentVersion?.id ||
              current.currentVersion.status !== "published"
            )
              throw new ListPreflightError("方案版本已变更，请刷新后重新选择");
            return membershipApi.disablePlan(
              current.id,
              current.currentVersion.id,
              reason,
            );
          },
          onComplete,
        },
      ]
    : [];
}

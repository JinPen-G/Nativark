/** 履约网络的导入、导出与批量状态保留原载荷、修订预检和明确重复冲突。 */
import type {
  RentalFulfillmentLocation,
  RentalFulfillmentOperator,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
} from "@rental-os/rental-core";
import { defineListImport, type ListBatchAction } from "@rental-os/platform-admin/ui";
import { ListPreflightError } from "@rental-os/platform-admin/ui";
import type { RentalLocationApi } from "./client";

type Translator = (key: string) => string;
type Complete = () => Promise<unknown>;
export interface RentalLocationListContext {
  api: Pick<RentalLocationApi, "locations" | "operators" | "saveLocation" | "saveOperator">;
  allowed: () => boolean;
}

function required(value: string | undefined, label: string) {
  if (!value?.trim()) throw new Error(label);
  return value.trim();
}
function choice<const T extends string>(value: string, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error(`${value}: ${choices.join(" / ")}`);
  return value as T;
}
/** Only known duplicate conflicts are skipped. Validation, permission and unknown errors remain failures. */
async function createOnly(operation: () => Promise<unknown>, duplicates: string[]) {
  try {
    return await operation();
  } catch (error) {
    const response = (error as { response?: { status?: number; data?: { message?: unknown } } }).response;
    if (
      response?.status === 409 &&
      typeof response.data?.message === "string" &&
      duplicates.includes(response.data.message)
    )
      return { skipped: true };
    throw error;
  }
}
function statusActions<T extends { id: string; status: string; updatedAt?: string }>(
  allowed: () => boolean,
  read: () => Promise<T[]>,
  save: (row: T, status: "enabled" | "disabled") => Promise<unknown>,
  onComplete: Complete,
): ListBatchAction<T>[] {
  return (["enabled", "disabled"] as const).map((status) => ({
    key: status,
    label: status === "enabled" ? "批量启用" : "批量停用",
    danger: status === "disabled",
    allowed: allowed,
    eligible: (row) => row.status !== status,
    run: async (row) => {
      const current = (await read()).find((item) => item.id === row.id);
      if (!current || (current.updatedAt && row.updatedAt && current.updatedAt !== row.updatedAt))
        throw new ListPreflightError("资料已变更，请刷新后重新选择");
      if (!allowed()) throw new ListPreflightError("当前操作不可用");
      if (current.status !== status) return save(current, status);
    },
    onComplete,
  }));
}

export function operatorCapabilities(
  t: Translator,
  onComplete: Complete,
  { api: rentalCoreApi, allowed }: RentalLocationListContext,
) {
  return {
    exportConfig: {
      filename: t("经营主体"),
      fields: [
        { label: t("编码"), value: (row: RentalFulfillmentOperator) => row.code },
        { label: t("名称"), value: (row: RentalFulfillmentOperator) => row.name },
        {
          label: t("经营方式"),
          value: (row: RentalFulfillmentOperator) => t(row.type === "partner" ? "合作商" : "自营"),
        },
        { label: t("结算方式"), value: (row: RentalFulfillmentOperator) => row.settlementMode },
        {
          label: t("状态"),
          value: (row: RentalFulfillmentOperator) => t(row.status === "enabled" ? "已启用" : "已停用"),
        },
      ],
    },
    importConfig: allowed()
      ? defineListImport<SaveRentalFulfillmentOperatorRequest>({
          filename: t("经营主体模板"),
          fields: [
            { key: "code", label: "编码", required: true },
            { key: "name", label: "名称", required: true },
            { key: "type", label: "经营方式", required: true, example: "self_operated / partner" },
            {
              key: "settlementMode",
              label: "结算方式",
              required: true,
              example: "self / monthly / per_order",
            },
          ],
          parse: (value) => ({
            code: required(value.code, "编码"),
            name: required(value.name, "名称"),
            type: choice(value.type, ["self_operated", "partner"]),
            settlementMode: choice(value.settlementMode, ["self", "monthly", "per_order"]),
            status: "enabled",
          }),
          key: (row) => row.code,
          existingKeys: async () => (await rentalCoreApi.operators()).map((row) => row.code),
          create: (value) => createOnly(() => rentalCoreApi.saveOperator(value), ["经营主体编码已存在"]),
          allowed,
          onComplete,
        })
      : undefined,
    batchActions: allowed()
      ? statusActions(
          allowed,
          rentalCoreApi.operators,
          (row, status) =>
            rentalCoreApi.saveOperator({
              id: row.id,
              code: row.code,
              name: row.name,
              type: row.type,
              settlementMode: row.settlementMode,
              contactName: row.contactName,
              contactPhone: row.contactPhone,
              status,
            }),
          onComplete,
        )
      : [],
  };
}

export function locationCapabilities(
  t: Translator,
  locationTypes: string[],
  onComplete: Complete,
  { api: rentalCoreApi, allowed }: RentalLocationListContext,
) {
  return {
    exportConfig: {
      filename: t("履约地点"),
      fields: [
        { label: t("编码"), value: (row: RentalFulfillmentLocation) => row.code },
        { label: t("名称"), value: (row: RentalFulfillmentLocation) => row.name },
        { label: t("经营主体"), value: (row: RentalFulfillmentLocation) => row.operatorName },
        { label: t("地点类型"), value: (row: RentalFulfillmentLocation) => row.type },
        { label: t("地址"), value: (row: RentalFulfillmentLocation) => row.address },
        {
          label: t("状态"),
          value: (row: RentalFulfillmentLocation) => t(row.status === "enabled" ? "已启用" : "已停用"),
        },
      ],
    },
    importConfig: allowed()
      ? defineListImport<SaveRentalFulfillmentLocationRequest>({
          filename: t("履约地点模板"),
          fields: [
            { key: "code", label: "编码", required: true },
            { key: "name", label: "名称", required: true },
            { key: "type", label: "地点类型", required: true, example: locationTypes.join(" / ") },
            { key: "operatorCode", label: "经营主体编码", required: true },
            {
              key: "capabilities",
              label: "履约能力",
              required: true,
              example: "pickup|return|storage|delivery",
            },
            { key: "address", label: "地址" },
          ],
          parse: (value) => {
            const type = choice(value.type, [
              "store",
              "warehouse",
              "station",
              "locker",
              "delivery_hub",
              "project_site",
            ]);
            if (!locationTypes.includes(type)) throw new Error("当前品类不支持该地点类型");
            return {
              code: required(value.code, "编码"),
              name: required(value.name, "名称"),
              type,
              operatorId: required(value.operatorCode, "经营主体编码"),
              capabilities: value.capabilities
                .split("|")
                .map((item) => choice(item.trim(), ["pickup", "return", "storage", "delivery"])),
              address: value.address || undefined,
              timezone: "Asia/Shanghai",
              status: "enabled",
            };
          },
          key: (row) => row.code,
          existingKeys: async () => (await rentalCoreApi.locations()).map((row) => row.code),
          create: async (value) => {
            // Template refers to readable operator codes. Resolve them without auto-creating an operator.
            const operator = (await rentalCoreApi.operators()).find(
              (row) => row.code === value.operatorId && row.status === "enabled",
            );
            if (!operator) throw new ListPreflightError("经营主体不存在或已停用");
            if (!allowed()) throw new ListPreflightError("当前操作不可用");
            return createOnly(
              () => rentalCoreApi.saveLocation({ ...value, operatorId: operator.id }),
              ["履约地点编码已存在"],
            );
          },
          allowed,
          onComplete,
        })
      : undefined,
    batchActions: allowed()
      ? statusActions(
          allowed,
          rentalCoreApi.locations,
          (row, status) =>
            rentalCoreApi.saveLocation({
              id: row.id,
              code: row.code,
              name: row.name,
              type: row.type,
              organizationId: row.organizationId,
              operatorId: row.operatorId,
              parentLocationId: row.parentLocationId,
              capabilities: row.capabilities,
              address: row.address,
              province: row.province,
              city: row.city,
              district: row.district,
              timezone: row.timezone,
              latitude: row.latitude,
              longitude: row.longitude,
              contactName: row.contactName,
              contactPhone: row.contactPhone,
              businessHours: row.businessHours,
              status,
            }),
          onComplete,
        )
      : [],
  };
}

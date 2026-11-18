/** 商品模板、完整导出和批量状态沿原字段及明确重复冲突，提交前读取当前权限。 */
import {
  RentalInventoryMode,
  type RentalAttributeDefinition,
  type RentalItemGroup,
  type SaveRentalItemGroupRequest,
} from "@rental-os/rental-core";
import { defineListImport, type ListBatchAction, type ListExport } from "@rental-os/platform-admin/ui";
import { ListPreflightError } from "@rental-os/platform-admin/source/components/ui/data-table/listTransfer";
import type { RentalCatalogApi } from "./client";
type Translator = (key: string) => string;
type Complete = () => Promise<unknown>;
export interface RentalCatalogListContext {
  api: Pick<RentalCatalogApi, "itemGroups" | "saveItemGroup">;
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
export function catalogCapabilities(
  t: Translator,
  fields: RentalAttributeDefinition[],
  onComplete: Complete,
  { api: rentalCoreApi, allowed }: RentalCatalogListContext,
  modes: RentalInventoryMode[],
  fixedMode?: RentalInventoryMode,
  fixedUnit?: string,
) {
  const exportConfig: ListExport<RentalItemGroup> = {
    filename: t("商品目录"),
    fields: [
      { label: t("编码"), value: (row) => row.code },
      { label: t("名称"), value: (row) => row.name },
      { label: t("库存模式"), value: (row) => row.inventoryMode },
      { label: t("单位"), value: (row) => row.unit },
      { label: t("状态"), value: (row) => t(row.status === "enabled" ? "已启用" : "已停用") },
      ...fields.map((field) => ({
        label: t(field.label),
        value: (row: RentalItemGroup) =>
          row.attributes[field.code] == null ? "" : String(row.attributes[field.code]),
      })),
    ],
  };
  const importConfig = allowed()
    ? defineListImport<SaveRentalItemGroupRequest>({
        filename: t("商品目录模板"),
        fields: [
          { key: "code", label: "编码", required: true },
          { key: "name", label: "名称", required: true },
          {
            key: "inventoryMode",
            label: "库存模式",
            required: !fixedMode,
            example: (fixedMode
              ? [fixedMode]
              : modes.filter((mode) => mode !== RentalInventoryMode.Bundle)
            ).join(" / "),
          },
          { key: "unit", label: "单位" },
          { key: "description", label: "说明" },
          ...fields.map((field) => ({
            key: `attr.${field.code}`,
            label: field.label,
            required: field.required,
            example: field.options?.join(" / "),
          })),
        ],
        parse: (values) => {
          const attributes: Record<string, unknown> = {};
          for (const field of fields) {
            const value = values[`attr.${field.code}`];
            if (!value) {
              if (field.required) throw new Error(`${field.label}: 必填`);
              continue;
            }
            if (field.type === "number") {
              if (!Number.isFinite(Number(value))) throw new Error(`${field.label}: 请输入数字`);
              attributes[field.code] = Number(value);
            } else if (field.type === "boolean")
              attributes[field.code] = choice(value, ["true", "false"]) === "true";
            else {
              if (field.options?.length && !field.options.includes(value))
                throw new Error(`${field.label}: ${field.options.join(" / ")}`);
              attributes[field.code] = value;
            }
          }
          const inventoryMode = choice(
            fixedMode ?? values.inventoryMode,
            modes.filter((mode) => mode !== RentalInventoryMode.Bundle),
          );
          return {
            code: required(values.code, "编码"),
            name: required(values.name, "名称"),
            inventoryMode,
            unit: fixedUnit || values.unit || undefined,
            description: values.description || undefined,
            attributes,
            status: "enabled",
          };
        },
        key: (value) => value.code,
        existingKeys: async () => (await rentalCoreApi.itemGroups()).map((row) => row.code),
        create: (value) => createOnly(() => rentalCoreApi.saveItemGroup(value), ["标的编码已存在"]),
        allowed,
        onComplete,
      })
    : undefined;
  const batchActions = allowed()
    ? statusActions(
        allowed,
        rentalCoreApi.itemGroups,
        (row, status) =>
          rentalCoreApi.saveItemGroup({
            id: row.id,
            code: row.code,
            name: row.name,
            inventoryMode: row.inventoryMode,
            unit: row.unit,
            description: row.description,
            attributes: Object.fromEntries(
              fields
                .filter((field) => Object.hasOwn(row.attributes, field.code))
                .map((field) => [field.code, row.attributes[field.code]]),
            ),
            bundleComponents: row.bundleComponents?.map((item) => ({
              itemGroupId: item.itemGroupId,
              quantity: item.quantity,
              optional: item.optional,
              substitutionGroup: item.substitutionGroup,
            })),
            status,
          }),
        onComplete,
      )
    : [];
  return { exportConfig, importConfig, batchActions };
}

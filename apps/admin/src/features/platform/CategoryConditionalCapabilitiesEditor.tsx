import { useQuery } from "@tanstack/react-query";
import { Space } from "antd";
import { Alert, Button, Collapse, ConfirmAction, Form, Select } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { QueryState } from "@/components/QueryState";
import { categoryGovernanceApi } from "@/api/categoryGovernance";
import type { CategoryDraftSection, RentalCategoryDefinition } from "@rental-os/shared";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const inventoryNames: Record<string, string> = { serialized: "单件资产", quantity: "数量库存", consumable: "耗材", bundle: "套装" };
const fulfillmentNames: Record<string, string> = { store_pickup_return: "门店取还", partner_pickup_return: "合作点取还",
  warehouse_pickup_return: "仓库取还", locker_pickup_return: "柜机取还", delivery: "配送取还", onsite_delivery: "现场交付", carrier_shipping: "承运寄送" };

/** Edits controlled selectors from Core metadata. The server owns evaluation and cross-section validation. */
export function CategoryConditionalCapabilitiesEditor({ value, definition, change, disabled, navigate, prepareInspectionFields }: {
  value: unknown; definition: RentalCategoryDefinition; change: (value: unknown) => void; disabled: boolean;
  navigate?: (section: CategoryDraftSection) => void;
  prepareInspectionFields?: (capabilityCode: string) => void;
}) {
  const { t } = useLocale();
  const catalog = useQuery({ queryKey: ["platform-category-capability-catalog"], queryFn: categoryGovernanceApi.catalog });
  const readable = Array.isArray(value) && value.every(record);
  const rows = readable ? value as Array<Record<string, unknown>> : [];
  const available = catalog.data?.capabilities.filter(capability => capability.implemented && capability.composition &&
    definition.defaultCapabilities.includes(capability.code) && !definition.requiredCapabilities.includes(capability.code) &&
    (capability.applicableCategories === "all" || capability.applicableCategories.includes(definition.code))) ?? [];
  const fields = definition.businessModel.assetFields.filter(field => field.scope === "item_group" && ["select", "boolean"].includes(field.type));
  const replace = (index: number, next: Record<string, unknown>) => change(rows.map((row, position) => position === index ? next : row));
  const setClause = (index: number, key: string, selected: unknown) => {
    const row = rows[index], when = record(row.when) ? { ...row.when } : {};
    if (selected === undefined || Array.isArray(selected) && !selected.length) delete when[key]; else when[key] = selected;
    replace(index, { ...row, when });
  };
  if (!readable) return <Space orientation="vertical">
    <Alert type="warning" title={t("原条件结构无法读取，尚未覆盖原输入")} />
    <ConfirmAction label={t("重新填写条件")} prompt={t("放弃无法读取的条件输入，从空条件集合重新填写？保存后才更新草稿。")}
      disabled={disabled} onConfirm={async () => change([])} />
  </Space>;
  return <QueryState loading={catalog.isLoading} error={catalog.error}>
    <Space orientation="vertical">
      <Alert type="info" title={t("条件同时满足时，该商品或操作必须具备对应能力。未触发的商品继续按原规则经营。")}
        description={t("检查字段的关联与依赖在对应页签保存；此处只保存条件，不自动修改其他页签。发布时由内核统一校验。程序未支持的能力不可新增。")}/>
      <Collapse items={rows.map((row, index) => {
        const when = record(row.when) ? row.when : {};
        const attribute = record(when.itemAttribute) ? when.itemAttribute : undefined;
        const field = fields.find(field => field.code === attribute?.code);
        const capability = catalog.data?.capabilities.find(capability => capability.code === row.code);
        return { key: String(index), label: capability?.label ?? t("条件必选能力"),
          extra: <Button disabled={disabled} onClick={event => { event.stopPropagation(); change(rows.filter((_, position) => position !== index)); }}>{t("删除")}</Button>,
          children: <>
            <Form.Item label={t("条件必选能力")}><Select aria-label={t("条件必选能力")} value={String(row.code ?? "")} disabled={disabled}
              options={available.map(capability => ({ value: capability.code, label: capability.label, disabled: rows.some((other, position) => position !== index && other.code === capability.code) }))}
              onChange={code => replace(index, { ...row, code })}/></Form.Item>
            <Form.Item label={t("库存形态条件")}><Select aria-label={t("库存形态条件")} mode="multiple" value={when.inventoryModes as string[] ?? []} disabled={disabled}
              options={definition.supportedInventoryModes.map(mode => ({ value: mode, label: t(inventoryNames[mode] ?? mode) }))} onChange={modes => setClause(index, "inventoryModes", modes)}/></Form.Item>
            <Form.Item label={t("履约方式条件")}><Select aria-label={t("履约方式条件")} mode="multiple" value={when.fulfillmentModes as string[] ?? []} disabled={disabled}
              options={definition.businessModel.fulfillmentModes.map(mode => ({ value: mode, label: t(fulfillmentNames[mode] ?? mode) }))} onChange={modes => setClause(index, "fulfillmentModes", modes)}/></Form.Item>
            <Form.Item label={t("型号分类属性")}><Select aria-label={t("型号分类属性")} allowClear value={attribute?.code as string | undefined} disabled={disabled}
              options={fields.map(field => ({ value: field.code, label: field.label }))} onChange={code => setClause(index, "itemAttribute", code ? { code, values: [] } : undefined)}/></Form.Item>
            {field && <Form.Item label={t("触发值")}><Select aria-label={t("触发值")} mode="multiple" disabled={disabled}
              value={(Array.isArray(attribute?.values) ? attribute.values : []).map(value => String(value))}
              options={field.type === "boolean" ? [{ value: "true", label: t("是") }, { value: "false", label: t("否") }] : field.options?.map(value => ({ value, label: value }))}
              onChange={values => setClause(index, "itemAttribute", { code: field.code, values: (values as string[]).map(value => field.type === "boolean" ? value === "true" : value) })}/></Form.Item>}
            {capability?.dependsOn.length ? <Alert type="info" title={t("依赖能力")}
              description={capability.dependsOn.map(code => catalog.data?.capabilities.find(value => value.code === code)?.label ?? code).join("、")}/> : null}
            {capability?.composition?.requiredInspectionFields?.length ? <Space orientation="vertical">
              <Alert type="warning" title={t("须核对交接字段")}
                description={capability.composition.requiredInspectionFields.map(field => `${field.label} · ${field.stages.map(stage => t(stage === "pickup" ? "领取" : "归还")).join("、")}`).join("；")}/>
              <Space wrap>
                {navigate && <Button disabled={disabled} onClick={() => navigate("inspection")}>{t("查看交接页签")}</Button>}
                {prepareInspectionFields && <Button disabled={disabled} onClick={() => prepareInspectionFields(capability.code)}>{t("准备所需交接字段")}</Button>}
              </Space>
            </Space> : null}
          </> };
      })}/>
      <Button disabled={disabled || rows.length >= 32 || !available.some(capability => !rows.some(row => row.code === capability.code))}
        onClick={() => { const capability = available.find(capability => !rows.some(row => row.code === capability.code));
          if (capability) change([...rows, { code: capability.code, when: { inventoryModes: capability.composition?.applicableInventoryModes?.filter(mode => definition.supportedInventoryModes.includes(mode)) ?? [...definition.supportedInventoryModes] } }]);
        }}>{t("新增条件")}</Button>
    </Space>
  </QueryState>;
}

import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { useState } from "react";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { Card, InputNumber, Space } from "antd";
import { Form, ActionButton } from "@/components/ui";
import { Collapse } from "@/components/ui";
import { App, Modal } from "@/components/ui";
import { Alert, Button, Input, Select, Switch, Table, Tabs } from "@/components/ui";
import { CATEGORY_DRAFT_SECTIONS, RENTAL_CATEGORY_ICON_CODES, RENTAL_CAPABILITY_MODULES, RENTAL_FULFILLMENT_MODES, RENTAL_LOCATION_TYPES, RENTAL_PRICING_UNIT_CODES, RentalInventoryMode, type CategoryDraftSection, type CategoryVersionView } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { categoryGovernanceApi } from "@/api/categoryGovernance";
import { CATEGORY_ATTRIBUTE_TYPES, CATEGORY_INSPECTION_TYPES, addCategoryAttributeSchemaField, categoryArrayUsesTags, updateCategoryField } from "./categoryDraftFields";
import { CategoryTemplateIcon } from "./CategoryTemplateIcon";

const ownership: Record<CategoryDraftSection, string[]> = {
  basic: ["name", "description", "terminology", "display"], attributes: ["attributeSchema", "assetFields", "catalogPresentation"],
  inventory: ["supportedInventoryModes", "fulfillmentModes", "locationTypes", "deliveryDestination"],
  pricing: ["pricingUnits", "defaultPricingUnit", "settingModules", "supportsHolidayPricing", "supportsUsagePricing", "supportsPreauthorization", "payment", "overdue", "fulfillment"],
  inspection: ["supportsQualificationReview", "rules", "inspectionFields"], capabilities: ["defaultCapabilities", "requiredCapabilities", "valueAddedServicePresets"]
};
const titles: Record<CategoryDraftSection, string> = { basic: "基本信息与术语", attributes: "商品与资产资料", inventory: "库存与履约", pricing: "计费与规则", inspection: "资质与交接检查", capabilities: "能力与发布" };
const labels: Record<string, string> = {
  name: "名称", description: "说明", terminology: "品类术语", attributeSchema: "属性类型", assetFields: "型号与资产字段", catalogPresentation: "目录展示", supportedInventoryModes: "库存模式",
  fulfillmentModes: "履约方式", locationTypes: "地点类型", deliveryDestination: "配送目的地", pricingUnits: "支持计价单位", defaultPricingUnit: "默认计价单位", settingModules: "设置模块",
  supportsHolidayPricing: "支持节假日定价", supportsUsagePricing: "支持使用量计价", supportsPreauthorization: "支持预授权", payment: "支付规则", overdue: "逾时规则", fulfillment: "履约规则",
  supportsQualificationReview: "支持资质审核", rules: "默认业务规则", inspectionFields: "交接检查字段", defaultCapabilities: "默认能力", requiredCapabilities: "必选能力", valueAddedServicePresets: "增值服务预设",
  code: "编码", label: "标签", type: "类型", scope: "适用对象", required: "必填", unique: "唯一", options: "可选值", usageMetric: "使用量读数", navigationLabels: "导航术语",
  itemLabel: "租赁商品称呼", itemGroupLabel: "商品型号称呼", assetLabel: "资产称呼", fulfillmentLabel: "履约地点称呼", pickupLabel: "领取动作称呼", returnLabel: "归还动作称呼", deliveryLabel: "配送动作称呼", identifierLabel: "资产编号称呼", serialLabel: "序列标识称呼", usageMetricLabel: "使用量指标称呼",
  inventoryGroup: "商品菜单分组", itemGroups: "型号菜单名称", pricingGroups: "定价分组菜单名称", assets: "资产库存菜单名称", locations: "地点菜单名称", unit: "单位",
  brand: "品牌", model: "型号", manufacturer: "制造商", equipmentType: "商品类型", mount: "接口规格", sensor: "传感器规格", securityRiskLevel: "风险等级", serialNo: "序列号", shutterCount: "快门次数",
  people: "适用人数", season: "适用季节", material: "材质", dimensions: "尺寸", capacity: "容量", batchNo: "批次号", trim: "款型", modelYear: "年款", seats: "座位数", transmission: "变速箱", energyType: "能源类型", licensePlate: "车牌", vin: "车辆识别码", color: "颜色", firstRegistrationDate: "登记日期", insuranceExpiry: "保险有效期", inspectionExpiry: "检验有效期", mileage: "里程",
  allowDifferentReturnLocation: "允许异地归还", timing: "收款时点", graceMinutes: "逾时宽限分钟", feeMode: "逾时收费方式", feeMultiplier: "收费倍率", evidenceRequired: "要求交接证据", cancellation: "取消规则", freeBeforeHours: "免费取消提前小时数", lateFeeType: "取消费类型", lateFeeValue: "取消费数值", weatherExceptionEnabled: "启用天气例外", qualificationDocumentTypes: "要求资质类型",
  power: "功率", ratedLoad: "额定载荷", ratedLoadUnit: "载荷单位", factoryNo: "出厂编号", hourMeter: "工时表", assetCollectionLabel: "资产集合称呼", itemGroupDescription: "型号页说明", itemGroupCodeLabel: "型号编码标签", itemGroupNameLabel: "型号名称标签", itemGroupNamePlaceholder: "型号名称提示", fixedInventoryMode: "固定库存方式", fixedUnit: "固定单位", itemGroupSummaryFields: "型号摘要字段", assetDescription: "资产页说明", assetSummaryFields: "资产摘要字段"
};
const choices: Record<string, readonly string[]> = {
  icon: RENTAL_CATEGORY_ICON_CODES,
  pricingUnits: RENTAL_PRICING_UNIT_CODES, defaultPricingUnit: RENTAL_PRICING_UNIT_CODES, fulfillmentModes: RENTAL_FULFILLMENT_MODES, locationTypes: RENTAL_LOCATION_TYPES,
  supportedInventoryModes: Object.values(RentalInventoryMode), fixedInventoryMode: Object.values(RentalInventoryMode), scope: ["item_group", "asset", "transaction"], type: CATEGORY_ATTRIBUTE_TYPES,
  deliveryDestination: ["customer_address", "tenant_location"], timing: ["order", "confirmation", "pickup", "offline_terms"], feeMode: ["none", "hourly", "next_period", "multiplier", "manual_review", "hourly_to_daily"], lateFeeType: ["none", "fixed_amount", "percentage"],
  settingModules: ["pricing", "discounts", "coupons", "value_added_services", "rental_rules", "business_calendar", "membership_rewards", "notification_templates"]
};
Object.assign(labels, { display: "中英文展示设置", nameEn: "英文名称", descriptionEn: "英文说明", icon: "品类图标", defaultWorkspaceName: "默认空间名称", defaultWorkspaceNameEn: "默认空间英文名称", terminologyEn: "英文业务术语" });
const iconLabels: Record<string, string> = { rental: "通用租赁", camera: "摄影设备", camping: "露营装备", construction: "工程设备", vehicle: "车辆载具", clothing: "服装", tool: "工具", package: "物品" };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function project(version: CategoryVersionView, section: CategoryDraftSection): Record<string, unknown> {
  const root = version.definition as unknown as Record<string, unknown>;
  const business = root.businessModel as Record<string, unknown>;
  const defaults = business.defaults as Record<string, unknown>;
  const projected = Object.fromEntries(ownership[section].flatMap((key) => {
    const value = root[key] ?? business[key] ?? defaults[key];
    return value === undefined ? [] : [[key, structuredClone(value)]];
  }));
  if (section === "basic") {
    const englishTerms = Object.fromEntries(Object.entries(version.definition.terminology).map(([key, value]) => [key,
      record(value) ? Object.fromEntries(Object.keys(value).map((field) => [field, ""])) : ""]));
    const display = record(projected.display) ? projected.display : {};
    projected.display = { nameEn: "", descriptionEn: "", icon: "rental", defaultWorkspaceName: "", defaultWorkspaceNameEn: "", ...display,
      terminologyEn: { ...englishTerms, ...(record(display.terminologyEn) ? display.terminologyEn : {}) } };
  }
  return projected;
}

function AttributeSchemaEditor({ value, change, disabled }: { value: Record<string, unknown>; change: (value: unknown) => void; disabled: boolean }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [code, setCode] = useState("");
  const [type, setType] = useState<string>("string");
  const options = CATEGORY_ATTRIBUTE_TYPES.map((entry) => ({ value: entry, label: entry }));
  return <Card size="small" title={t("属性类型")}>
    <Alert type="info" title={t("属性概要不代替型号与资产字段声明；必填、选项与唯一要求请在下方字段配置。")} />
    <Table rowKey="code" size="small" pagination={false} dataSource={Object.entries(value).map(([key, entry]) => ({ code: key, type: String(entry) }))} columns={[
      { title: t("字段编码"), dataIndex: "code" },
      { title: t("类型"), dataIndex: "type", render: (entry: string, row: { code: string }) => <Select aria-label={`${t("类型")} ${row.code}`} value={entry} options={options} disabled={disabled} onChange={(next) => change({ ...value, [row.code]: next })} /> },
      { title: t("操作"), render: (_, row: { code: string }) => <Button disabled={disabled} onClick={() => change(Object.fromEntries(Object.entries(value).filter(([key]) => key !== row.code)))}>{t("删除")}</Button> }
    ]} />
    {!disabled && <Space wrap>
      <Input aria-label={t("新字段编码")} placeholder={t("新字段编码")} value={code} maxLength={64} onChange={(event) => setCode(event.target.value)} />
      <Select aria-label={t("新字段类型")} value={type} options={options} onChange={setType} />
      <Button onClick={() => { try { change(addCategoryAttributeSchemaField(value, code, type)); setCode(""); } catch (error) { message.warning(t(error instanceof Error ? error.message : "字段类型不合法")); } }}>{t("新增字段")}</Button>
    </Space>}
  </Card>;
}

/** Structured controls only: category administrators never need to write JSON. */
function ValueEditor({ name, value, change, disabled, inspection = false }: { name: string; value: unknown; change: (value: unknown) => void; disabled: boolean; inspection?: boolean }) {
  const { t, locale } = useLocale();
  const [baseName, suffix] = name.split(" ");
  const label = locale === "en-US" ? name.replace(/([A-Z])/g, " $1") : `${t(labels[baseName] ?? baseName)}${suffix ? ` ${suffix}` : ""}`;
  if (name === "attributeSchema" && record(value)) return <AttributeSchemaEditor value={value} change={change} disabled={disabled} />;
  if (typeof value === "boolean") return <Form.Item label={label}><Switch aria-label={label} checked={value} onChange={change} disabled={disabled} /></Form.Item>;
  if (typeof value === "number") return <Form.Item label={label}><InputNumber aria-label={label} value={value} onChange={(next) => { if (next !== null) change(next); }} disabled={disabled} /></Form.Item>;
  if (Array.isArray(value)) {
    if (choices[name] || name.endsWith("Capabilities") || categoryArrayUsesTags(name, value)) {
      const capabilities = name.endsWith("Capabilities");
      // Existing unimplemented selections must remain removable so a legacy copy
      // can be corrected. They cannot be newly selected after removal.
      const options = capabilities ? RENTAL_CAPABILITY_MODULES.map((entry) => ({ value: entry.code, label: locale === "en-US" ? entry.code : entry.label, disabled: !entry.implementationVersion && !value.includes(entry.code) })) : choices[name]?.map((entry) => ({ value: entry, label: entry }));
      return <Form.Item label={label}><Select aria-label={label} mode={options ? "multiple" : "tags"} value={value as string[]} options={options} onChange={change} disabled={disabled} /></Form.Item>;
    }
    const template = name === "assetFields" ? { code: "", label: "", scope: "asset", type: "string", required: false, unique: false } : name === "inspectionFields" ? { code: "", label: "", type: "text", required: false } : value[0];
    return <Card size="small" title={label}>
      <Collapse items={value.map((entry, index) => ({ key: String(index), label: record(entry) ? String(entry.label || entry.code || `${label} ${index + 1}`) : `${label} ${index + 1}`,
        extra: <Button disabled={disabled} onClick={(event) => { event.stopPropagation(); change(value.filter((_, i) => i !== index)); }}>{t("删除")}</Button>,
        children: <ValueEditor name={`${name} ${index + 1}`} value={entry} change={(next) => change(value.map((item, i) => i === index ? next : item))} disabled={disabled} inspection={inspection || name === "inspectionFields"} />
      }))} />
      <Button disabled={disabled || !template} onClick={() => change([...value, structuredClone(template)])}>{t("新增字段")}</Button>
    </Card>;
  }
  if (record(value)) {
    const fields = { ...value };
    if (value.type === "select" && !Array.isArray(value.options)) fields.options = [];
    return <Card size="small" title={label}>{Object.entries(fields).map(([key, entry]) => <ValueEditor key={key} name={key} value={entry} change={(next) => change(updateCategoryField(fields, key, next, inspection))} disabled={disabled} inspection={inspection} />)}</Card>;
  }
  const fieldChoices = inspection && name === "type" ? CATEGORY_INSPECTION_TYPES : choices[name];
  return <Form.Item label={label}>{fieldChoices ? <Select aria-label={label} value={String(value ?? "")} options={fieldChoices.map((entry) => ({ value: entry, label: name === "icon" ? <Space><CategoryTemplateIcon code={entry} />{t(iconLabels[entry])}</Space> : entry }))} onChange={change} disabled={disabled} /> : <Input aria-label={label} value={String(value ?? "")} onChange={(event) => change(event.target.value)} disabled={disabled} maxLength={2048} />}</Form.Item>;
}

export function CategoryDraftEditor({ code, initial, editable, canPublish, saved, close }: { code: string; initial: CategoryVersionView; editable: boolean; canPublish: boolean; saved: () => void; close: () => void }) {
  const { t } = useLocale();
  const dismissal = useModalDismissal(true, close);
  const { message, modal } = App.useApp();
  const [version, setVersion] = useState(initial);
  const [section, setSection] = useState<CategoryDraftSection>("basic");
  const [values, setValues] = useState(() => project(initial, "basic"));
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [publishKey, setPublishKey] = useState(() => crypto.randomUUID());
  const hasUnsavedInput = dirty || Boolean(reason.trim());
  const guarded = (action: () => void) => hasUnsavedInput ? modal.confirm({ title: t("有未保存的改动，确定放弃吗？"), onOk: action }) : action();
  const canEdit = editable && version.status === "draft" && !busy;
  const save = async () => {
    if (!reason.trim()) { message.warning(t("请填写变更原因")); throw new Error("Change reason required"); }
    setBusy(true);
    try {
      const next = await categoryGovernanceApi.patch(code, version.id, section, { expectedRevision: version.revision, values, reason });
      setVersion(next); setValues(project(next, section)); setDirty(false); setReason(""); setErrors([]); setPublishKey(crypto.randomUUID()); saved(); message.success(t("当前页签草稿已保存"));
    } catch (error) {
      const response = error as { response?: { status?: number; data?: { message?: string } } };
      message.error(response.response?.status === 409 ? t("草稿修订冲突，输入已保留，请重新核对最新版本") : t("保存失败，输入已保留"));
      throw error;
    } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!reason.trim()) { message.warning(t("请填写变更原因")); return; }
    setBusy(true);
    try {
      const preview = await categoryGovernanceApi.preview(code, version.id);
      if (!preview.valid) { setErrors(preview.errors); return; }
      if (preview.revision !== version.revision) { message.error(t("草稿修订冲突，输入已保留，请重新核对最新版本")); return; }
      const differenceKinds: Record<string, string> = { added: "新增", removed: "移除", changed: "修改", required_added: "新增必填要求", unique_enabled: "启用唯一要求", type_changed: "字段类型变化", scope_narrowed: "支持范围收窄" };
      const displayValue = (value: unknown) => value === null || value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
      let confirmation: { destroy: () => void };
      confirmation = modal.confirm({ title: t("确认整体发布品类版本？"), width: "90%", content: <Space orientation="vertical"><span>{t("发布后正文不可修改；新版本采用资格默认关闭，不会改变已有空间绑定。")}</span><span>{t("变更页签")}: {preview.changedSections.map((key) => t(titles[key])).join("、")}</span><span>{t("现有品类空间数")}: {preview.affectedSpaces}</span>
        <Table size="small" rowKey="path" dataSource={preview.differences ?? []} pagination={{ pageSize: 10 }} scroll={{ x: 650 }} columns={[
          { title: t("变更字段"), dataIndex: "label" }, { title: t("变更类型"), dataIndex: "kind", render: (value: string) => t(differenceKinds[value] ?? value) },
          { title: t("变更前"), dataIndex: "before", render: displayValue }, { title: t("变更后"), dataIndex: "after", render: displayValue },
          ...(editable ? [{ title: t("操作"), render: (_: unknown, row: { section: CategoryDraftSection }) => <Button onClick={() => {
            confirmation.destroy(); setSection(row.section); setValues(project(version, row.section)); setDirty(false); setErrors([]);
          }}>{t("返回对应页签修改")}</Button> }] : [])
        ]} />
      </Space>, onOk: async () => {
        setBusy(true);
        try {
          const next = await categoryGovernanceApi.publish(code, version.id, { expectedRevision: version.revision, idempotencyKey: publishKey, reason });
          setVersion(next); setReason(""); setErrors([]); saved(); message.success(t("版本已发布，采用资格尚未开放"));
        } catch (error) { message.error(t("发布失败，请核对校验结果和版本修订")); throw error; }
        finally { setBusy(false); }
      } });
    } catch { message.error(t("预览失败，请重试")); }
    finally { setBusy(false); }
  };
  return <Modal presentation="side" title={`${t("品类版本")} ${version.versionLabel} · ${t("修订")} ${version.revision}`} open={dismissal.visible} afterClose={dismissal.afterClose} footer={null} width="min(1280px, 96vw)" mask={{ closable: false }} onCancel={() => { if (!busy) guarded(dismissal.dismiss); }}>
    <UnsavedChangesGuard dirty={hasUnsavedInput} busy={busy} />
    <Alert type="info" showIcon title={t("每个页签只保存自己的草稿；保存不会发布或改变经营空间。已发布版本只读。")} />
    <Tabs activeKey={section} onChange={(key) => { if (!busy) guarded(() => { const next = key as CategoryDraftSection; setSection(next); setValues(project(version, next)); setDirty(false); setReason(""); setErrors([]); }); }} items={CATEGORY_DRAFT_SECTIONS.map((key) => ({ key, label: t(titles[key]) }))} />
    <ContentTransition value={section}><Form layout="vertical">{Object.entries(values).map(([key, value]) => <ValueEditor key={key} name={key} value={value} change={(next) => { setValues((current) => ({ ...current, [key]: next })); setDirty(true); }} disabled={!canEdit} />)}</Form></ContentTransition>
    {errors.length > 0 && <Alert type="error" title={t("配置校验未通过")} description={errors.join("；")} />}
    <Space wrap>
      {(editable || canPublish) && version.status === "draft" && <Input aria-label={t("变更原因")} placeholder={t("变更原因")} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} maxLength={512} />}
      {editable && version.status === "draft" && <ActionButton label={t("保存当前页签草稿")} disabled={!dirty} pending={busy} onAction={save} />}
      {section === "capabilities" && canPublish && version.status === "draft" && <Button type="primary" disabled={dirty || busy} onClick={publish}>{t("校验并整体发布")}</Button>}
      <Button disabled={dirty || busy} onClick={async () => { setBusy(true); try { const result = await categoryGovernanceApi.validate(code, version.id); setErrors(result.errors); if (result.valid) message.success(t("配置校验通过")); } catch { message.error(t("校验失败，请重试")); } finally { setBusy(false); } }}>{t("校验已保存版本")}</Button>
      <Button disabled={busy} onClick={() => guarded(close)}>{t("关闭")}</Button>
    </Space>
  </Modal>;
}

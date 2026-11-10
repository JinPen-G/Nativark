import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Space } from "antd";
import { ActionButton, Alert, App, Button, Form, Input, Modal, Select, Table } from "@/components/ui";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { QueryState } from "@/components/QueryState";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { categoryGovernanceApi } from "@/api/categoryGovernance";
import { fulfillmentModeLabels } from "@/features/fulfillment/fulfillmentLabels";
import { RENTAL_PRICING_UNIT_LABELS, type CategoryVersionView, type PreviewRentalCategoryCreationRequest, type CreateRentalCategoryRequest, type RentalCategoryCreationPreview } from "@rental-os/shared";

type Values = Omit<PreviewRentalCategoryCreationRequest, "templateId" | "sourceVersionId"> & { reason: string };
const inventoryNames: Record<string, string> = { serialized: "单件资产", quantity: "数量库存", bundle: "套装", consumable: "耗材" };

/** Previews one new definition before committing. Unknown outcomes keep the original input/key; the server still owns identity and publication. */
export function CategoryCreationDialog({ sourceCode, created, close }: {
  sourceCode?: string; created: (version: CategoryVersionView) => Promise<void>; close: () => void;
}) {
  const { t } = useLocale(), { message, modal } = App.useApp();
  const dismissal = useModalDismissal(true, close);
  const owner = useRef(useAuthStore.getState().user?.id);
  const [form] = Form.useForm<Values>();
  const [sourceType, setSourceType] = useState<"template" | "copy">(sourceCode ? "copy" : "template");
  const [templateId, setTemplateId] = useState<"serialized" | "quantity" | "kit">("serialized");
  const [copyCode, setCopyCode] = useState(sourceCode);
  const [versionId, setVersionId] = useState<string>();
  const [preview, setPreview] = useState<{ result: RentalCategoryCreationPreview; input: PreviewRentalCategoryCreationRequest }>();
  const [original, setOriginal] = useState<CreateRentalCategoryRequest>();
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [unknown, setUnknown] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const loadedSource = useRef<string | undefined>(undefined);
  const catalog = useQuery({ queryKey: ["platform-category-capability-catalog"], queryFn: categoryGovernanceApi.catalog });
  const categories = useQuery({ queryKey: ["platform-category-governance"], queryFn: categoryGovernanceApi.list, enabled: sourceType === "copy" });
  const detail = useQuery({ queryKey: ["platform-category-governance", copyCode], queryFn: () => categoryGovernanceApi.detail(copyCode!), enabled: sourceType === "copy" && Boolean(copyCode) });
  const source = sourceType === "template" ? catalog.data?.templates.find(template => template.id === templateId)?.definition
    : detail.data?.versions.find(version => version.id === versionId && ["published", "legacy_baseline"].includes(version.status))?.definition;
  const sourceKey = sourceType === "template" ? `template:${templateId}` : `version:${versionId ?? ""}`;
  useEffect(() => {
    if (!source || loadedSource.current === sourceKey) return;
    loadedSource.current = sourceKey;
    form.setFieldsValue({ inventoryModes: [...source.supportedInventoryModes], pricingUnits: [...source.businessModel.pricingUnits],
      defaultPricingUnit: source.businessModel.defaultPricingUnit, fulfillmentModes: [...source.businessModel.fulfillmentModes],
      capabilityCodes: source.defaultCapabilities.filter(code => catalog.data?.capabilities.some(capability => capability.code === code && capability.implemented && capability.applicableCategories === "all")) });
    setPreview(undefined);
  }, [source, sourceKey, form, catalog.data]);
  const assertOwner = () => { if (!owner.current || useAuthStore.getState().user?.id !== owner.current) throw new Error(t("当前账号已变化，请重新打开创建入口")); };
  const prepare = async () => {
    assertOwner();
    const values = await form.validateFields();
    if (!source) throw new Error(t("请选择创建来源"));
    const input: PreviewRentalCategoryCreationRequest = { code: values.code, name: values.name, versionLabel: values.versionLabel,
      inventoryModes: values.inventoryModes, pricingUnits: values.pricingUnits, defaultPricingUnit: values.defaultPricingUnit,
      fulfillmentModes: values.fulfillmentModes, capabilityCodes: values.capabilityCodes,
      ...(sourceType === "template" ? { templateId } : { sourceVersionId: versionId }) };
    setBusy(true);
    try { const result = await categoryGovernanceApi.previewCreation(input); assertOwner(); setPreview({ result, input: structuredClone(input) }); }
    finally { setBusy(false); }
  };
  const finish = async (version: CategoryVersionView) => {
    setUnknown(false); setDirty(false); setOriginal(undefined);
    try { await created(version); }
    catch { message.warning(t("草稿已创建，详情刷新失败，请从列表重新打开")); }
    dismissal.dismiss();
  };
  const submit = async (request: CreateRentalCategoryRequest) => {
    assertOwner(); setBusy(true); setOriginal(structuredClone(request));
    try { const version = await categoryGovernanceApi.createCategory(request); assertOwner(); await finish(version); }
    catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (!status || status >= 500) { setUnknown(true); message.warning(t("创建结果待核对，请读取原收据或用原操作重试")); }
      else message.error(t("创建未完成，输入已保留，请核对校验或原收据"));
      throw error;
    } finally { setBusy(false); }
  };
  const create = async () => {
    const values = await form.validateFields();
    if (!preview?.result.valid) throw new Error(t("请先核对有效预览"));
    await submit({ ...preview.input, expectedDefinitionHash: preview.result.definitionHash, idempotencyKey: key, reason: values.reason });
  };
  const readReceipt = async () => {
    assertOwner(); setBusy(true);
    try { const receipt = await categoryGovernanceApi.creationReceipt(key); assertOwner();
      if (receipt.outcome === "created") await finish(receipt.version); else message.info(t("原创建结果仍待核对，保留原输入和操作键"));
    } finally { setBusy(false); }
  };
  const disabled = busy || unknown;
  const guardedClose = () => { if (disabled) return;
    if (dirty) modal.confirm({ title: t("有未保存的改动，确定放弃吗？"), onOk: dismissal.dismiss }); else dismissal.dismiss(); };
  return <Modal title={t("新建租赁品类")} open={dismissal.visible} afterClose={dismissal.afterClose} footer={null} width={840}
    mask={{ closable: false }} keyboard={!disabled} closable={!disabled} onCancel={guardedClose}>
    <UnsavedChangesGuard dirty={dirty || unknown} busy={disabled}/>
    <QueryState loading={catalog.isLoading} error={catalog.error}>
      <Alert type="info" title={t("先选择来源与能力，核对完整草稿后创建。新建不开放品类，也不复制商户经营数据。")}/>
      <Form form={form} layout="vertical" initialValues={{ versionLabel: "1.0" }} disabled={disabled} onValuesChange={() => { setDirty(true); setPreview(undefined); }}>
        <Form.Item label={t("创建来源")}><Select aria-label={t("创建来源")} value={sourceType} disabled={disabled} options={[{ value: "template", label: t("通用模板") }, { value: "copy", label: t("已有发布版本") }]}
          onChange={type => { setSourceType(type); setPreview(undefined); }}/></Form.Item>
        {sourceType === "template" ? <Form.Item label={t("模板")}><Select aria-label={t("模板")} value={templateId} disabled={disabled} options={catalog.data?.templates.map(template => ({ value: template.id, label: t(template.definition.name) }))}
          onChange={id => { setTemplateId(id); setPreview(undefined); }}/></Form.Item>
          : <QueryState loading={categories.isLoading || detail.isLoading} error={categories.error ?? detail.error}>
            <Form.Item label={t("来源品类")}><Select aria-label={t("来源品类")} value={copyCode} disabled={disabled} options={categories.data?.map(category => ({ value: category.code, label: category.name }))}
              onChange={code => { setCopyCode(code); setVersionId(undefined); setPreview(undefined); }}/></Form.Item>
            <Form.Item label={t("来源发布版本")}><Select aria-label={t("来源发布版本")} value={versionId} disabled={disabled} options={detail.data?.versions.filter(version => ["published", "legacy_baseline"].includes(version.status)).map(version => ({ value: version.id, label: version.versionLabel }))}
              onChange={id => { setVersionId(id); setPreview(undefined); }}/></Form.Item>
          </QueryState>}
        <Form.Item name="code" label={t("品类编码")} rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_]{1,63}(?![\s\S])/u }]}><Input maxLength={64}/></Form.Item>
        <Form.Item name="name" label={t("品类名称")} rules={[{ required: true, whitespace: true }]}><Input maxLength={100}/></Form.Item>
        <Form.Item name="versionLabel" label={t("新版本号")} rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?![\s\S])/u }]}><Input maxLength={64}/></Form.Item>
        <Form.Item name="inventoryModes" label={t("库存模式")} rules={[{ required: true }]}><Select mode="multiple" options={source?.supportedInventoryModes.map(mode => ({ value: mode, label: t(inventoryNames[mode] ?? mode) }))}/></Form.Item>
        <Form.Item name="pricingUnits" label={t("支持计价单位")} rules={[{ required: true }]}><Select mode="multiple" options={source?.businessModel.pricingUnits.map(unit => ({ value: unit, label: t(RENTAL_PRICING_UNIT_LABELS[unit] ?? unit) }))}/></Form.Item>
        <Form.Item name="defaultPricingUnit" label={t("默认计价单位")} rules={[{ required: true }]}><Select options={source?.businessModel.pricingUnits.map(unit => ({ value: unit, label: t(RENTAL_PRICING_UNIT_LABELS[unit] ?? unit) }))}/></Form.Item>
        <Form.Item name="fulfillmentModes" label={t("履约方式")} rules={[{ required: true }]}><Select mode="multiple" options={source?.businessModel.fulfillmentModes.map(mode => ({ value: mode, label: t(fulfillmentModeLabels[mode] ?? mode) }))}/></Form.Item>
        <Form.Item name="capabilityCodes" label={t("能力组合")} rules={[{ required: true }]}><Select mode="multiple" options={catalog.data?.capabilities.filter(capability => source?.defaultCapabilities.includes(capability.code) && capability.applicableCategories === "all" && capability.implemented).map(capability => ({ value: capability.code, label: capability.label }))}/></Form.Item>
        <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={512}/></Form.Item>
      </Form>
      {preview && <Space orientation="vertical">
        <Alert type={preview.result.valid ? "info" : "error"} title={t(preview.result.valid ? "草稿预览已核对，可创建独立品类" : "配置校验未通过")} description={preview.result.errors.join("；")}/>
        {preview.result.removedCapabilities.length > 0 && <Alert type="warning" title={t("将移除来源能力")}
          description={preview.result.removedCapabilities.map(code => catalog.data?.capabilities.find(capability => capability.code === code)?.label ?? code).join("、")}/>}
        <Table rowKey="code" pagination={false} dataSource={preview.result.definition.businessModel.assetFields} columns={[{ title: t("字段"), dataIndex: "label" },
          { title: t("适用对象"), dataIndex: "scope", render: value => t(({ item_group: "商品型号", asset: "单件资产", transaction: "交接记录" } as Record<string, string>)[value] ?? value) },
          { title: t("类型"), dataIndex: "type", render: value => t(({ string: "文本", number: "数值", boolean: "是或否", select: "选项", date: "日期" } as Record<string, string>)[value] ?? value) }]}/>
        <Table rowKey="code" pagination={false} dataSource={preview.result.definition.businessModel.defaults.inspectionFields} columns={[{ title: t("交接检查字段"), dataIndex: "label" }, { title: t("必填"), dataIndex: "required", render: value => t(value ? "是" : "否") }]}/>
      </Space>}
      {unknown && <Alert type="warning" title={t("创建结果待核对，请读取原收据或用原操作重试")}/>}
      <Space wrap>
        {!unknown && <><ActionButton label={t("核对草稿预览")} pending={busy} disabled={!source} onAction={prepare}/>
          <ActionButton label={t("创建草稿")} pending={busy} disabled={!preview?.result.valid || !catalog.data?.dynamicCreationEnabled} onAction={create}/></>}
        <ActionButton label={t("读取原创建收据")} pending={busy} disabled={!original} onAction={readReceipt}/>
        {unknown && original && <ActionButton label={t("用原操作重试创建")} pending={busy} onAction={() => submit(original)}/>}
        <Button disabled={disabled} onClick={guardedClose}>{t("取消")}</Button>
      </Space>
    </QueryState>
  </Modal>;
}

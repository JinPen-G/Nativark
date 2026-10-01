import { DeleteOutlined, MinusCircleOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { RentalInventoryMode, type RentalAttributeDefinition, type RentalItemGroup, type SaveRentalItemGroupRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Card, Col, Empty, InputNumber, Row, Space, Tag, Typography } from "antd";
import { Form } from "@/components/ui";
import { Alert, Table, Upload } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, Drawer, SaveButton, SearchField, Select } from "@/components/ui";
import type { UploadFile } from "antd";
import { useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { resolveTenantNavigationLabels } from "@/app/navigation-terminology";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { ItemGroupPhoto } from "./ItemGroupPhoto";

const inventoryLabels: Record<string, string> = { serialized: "序列化资产", quantity: "数量库存", consumable: "一次性耗材", bundle: "套装" };
const cameraEquipmentTypeLabels: Record<string, [string, string]> = {
  camera_body: ["相机机身", "Camera body"],
  lens: ["镜头", "Lens"],
  tripod: ["三脚架", "Tripod"],
  gimbal_camera: ["云台相机", "Gimbal camera"],
  action_camera: ["运动相机", "Action camera"],
  lighting: ["灯光", "Lighting"],
  other: ["其他器材", "Other equipment"]
};
const securityRiskLevelLabels: Record<string, [string, string]> = {
  low: ["低风险", "Low risk"],
  standard: ["一般风险", "Standard risk"],
  high: ["高风险", "High risk"]
};

function riskLevelLabels(riskLevel: string, locale: string, t: (value: string) => string) {
  if (!riskLevel || !securityRiskLevelLabels[riskLevel]) return <Tag color="warning">{t("未分级")}</Tag>;
  const color = riskLevel === "high" ? "error" : riskLevel === "standard" ? "processing" : "success";
  return <Tag color={color}>{securityRiskLevelLabels[riskLevel][locale === "en-US" ? 1 : 0]}</Tag>;
}

/**
 * 品类动态属性的受控控件。
 *
 * 必须把 Form.Item 注入的受控属性透传给内部控件：`(field) => <Input />` 会让控件退化成
 * 非受控，输入只改 DOM、不进表单值——而四个品类的 item_group 必填属性（厂商/品牌/型号等）
 * 都在这里，表现为「框里明明有值，保存却报请输入厂商」且不发出任何请求，新增型号被彻底卡死。
 */
function AttributeInput({
  field,
  value,
  checked,
  onChange,
  id
}: {
  field: RentalAttributeDefinition;
  value?: unknown;
  checked?: boolean;
  onChange?: (...args: never[]) => void;
  id?: string;
}) {
  const { locale } = useLocale();
  if (field.type === "number") {
    return <InputNumber id={id} min={0} suffix={field.unit} style={{ width: "100%" }} value={value as number} onChange={onChange as (value: number | null) => void} />;
  }
  if (field.type === "select") {
    return <Select id={id} options={field.options?.map((option) => ({ value: option, label: field.code === "equipmentType"
      ? cameraEquipmentTypeLabels[option]?.[locale === "en-US" ? 1 : 0] ?? option
      : field.code === "securityRiskLevel"
        ? securityRiskLevelLabels[option]?.[locale === "en-US" ? 1 : 0] ?? option
        : option }))} value={value as string} onChange={onChange as (value: string) => void} />;
  }
  if (field.type === "boolean") {
    // Form.Item 对该类字段使用 valuePropName="checked"，注入的是 checked 而非 value。
    return <Switch id={id} checked={checked ?? Boolean(value)} onChange={onChange as (checked: boolean) => void} />;
  }
  return <Input id={id} type={field.type === "date" ? "date" : undefined} value={value as string} onChange={onChange as (event: unknown) => void} />;
}

export function CatalogPage() {
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((state) => state.hasPermission("rental-core:catalog:manage"));
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<RentalItemGroup>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<UploadFile[]>([]);
  const [form] = Form.useForm<SaveRentalItemGroupRequest>();
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const pricingGroups = useQuery({ queryKey: ["rental-core", "pricing-groups"], queryFn: rentalCoreApi.pricingGroups });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const categories = useQuery({ queryKey: ["rental-core", "categories"], queryFn: rentalCoreApi.categories });
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const presentation = category?.businessModel.catalogPresentation;
  const groupFields = category?.businessModel.assetFields.filter((field) => field.scope === "item_group") ?? [];
  const summaryFields = (presentation?.itemGroupSummaryFields ?? ["manufacturer", "brand", "model"])
    .map((code) => groupFields.find((field) => field.code === code))
    .filter((field): field is RentalAttributeDefinition => Boolean(field));
  const itemGroupLabel = t(profile.data?.terminology.itemGroupLabel ?? "产品型号");
  const save = useMutation({
    mutationFn: async (values: SaveRentalItemGroupRequest) => {
      let group = await rentalCoreApi.saveItemGroup(values);
      for (const file of pendingFiles) {
        if (file.originFileObj) group = await rentalCoreApi.uploadItemGroupImage(group.id, file.originFileObj);
      }
      return group;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "groups"] });
      setDrawerOpen(false);
      setEditing(undefined);
      form.resetFields();
      setPendingFiles([]);
      message.success(`${itemGroupLabel}${t("已保存")}`);
    },
    onError: () => message.error(t("保存失败，请检查编码、库存模式、品类字段和套装组成"))
  });
  const removeImage = useMutation({
    mutationFn: ({ groupId, imageId }: { groupId: string; imageId: string }) => rentalCoreApi.removeItemGroupImage(groupId, imageId),
    onSuccess: async (group) => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "groups"] });
      setEditing(group);
      message.success(t("照片已删除"));
    },
    onError: () => message.error(t("照片删除失败"))
  });
  const rows = useMemo(() => (groups.data ?? []).filter((item) => `${item.code}${item.name}${Object.values(item.attributes).join("")}`.toLowerCase().includes(keyword.toLowerCase())), [groups.data, keyword]);

  function openEditor(record?: RentalItemGroup) {
    setEditing(record);
    setPendingFiles([]);
    form.setFieldsValue(record ?? {
      code: "",
      name: "",
      inventoryMode: presentation?.fixedInventoryMode ?? category?.supportedInventoryModes[0] ?? RentalInventoryMode.Serialized,
      unit: presentation?.fixedUnit ?? "件",
      description: "",
      attributes: {},
      bundleComponents: [],
      status: "enabled"
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title={t(resolveTenantNavigationLabels(profile.data?.terminology).routes.itemGroups ?? "商品目录")} description={locale === "en-US" ? "Maintain product models, shared specifications, and inventory modes for this category. Commercial pricing groups and individual assets are managed separately." : presentation?.itemGroupDescription ?? "按经营品类维护产品型号、共享规格和库存形态；商业定价分组与具体资产在各自页面维护。"} note={{ title: `${itemGroupLabel}${t("是厂商产品主档，不是定价分组")}`, description: locale === "en-US" ? `This page stores manufacturer, brand, model, and shared specifications. ${t(profile.data?.terminology.identifierLabel ?? "资产编号")} and other per-asset information are maintained in “${t(resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产管理")}”; customer-facing commercial groups are created in “${t(resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ?? "定价分组") }”.` : `这里保存厂商、品牌、型号和共享规格；${profile.data?.terminology.identifierLabel ?? "资产编号"}等单件信息在“${resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产管理"}”登记，面向客户的商业分组在“${resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ?? "定价分组"}”建立。` }} extra={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{locale === "en-US" ? `${t("新增")} ${itemGroupLabel}` : `${t("新增")}${itemGroupLabel}`}</Button> : undefined} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space style={{ marginBottom: 16 }}><SearchField label={t("搜索商品型号")} placeholder={t("搜索编码、名称或规格")} value={keyword} onValueChange={setKeyword} style={{ width: 300 }} /></Space>
        <QueryState loading={groups.isLoading || pricingGroups.isLoading || profile.isLoading || categories.isLoading} error={groups.error || pricingGroups.error || profile.error || categories.error}>
          <Table<RentalItemGroup> rowKey="id" dataSource={rows} scroll={{ x: 960 }} columns={[
            { title: t("照片"), width: 82, render: (_, row) => row.images?.[0] ? <ItemGroupPhoto groupId={row.id} image={row.images.find((image) => image.isCover) ?? row.images[0]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} styles={{ image: { height: 36 } }} /> },
            { title: itemGroupLabel, fixed: "left", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code}</span></> },
            { title: t("商品风控等级"), width: 120, render: (_, row) => {
              const riskLevel = String(row.attributes.securityRiskLevel ?? "");
              return riskLevelLabels(riskLevel, locale, t);
            } },
            ...summaryFields.map((field) => ({ title: t(field.label), render: (_: unknown, row: RentalItemGroup) => String(row.attributes[field.code] ?? "-") })),
            { title: t(resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ?? "所属定价分组"), render: (_, row) => {
              const memberships = (pricingGroups.data ?? []).filter((pricingGroup) => pricingGroup.memberItemGroupIds.includes(row.id));
              return memberships.length ? <Space size={[4, 4]} wrap>{memberships.map((pricingGroup) => <Tag color="processing" key={pricingGroup.id}>{pricingGroup.name}</Tag>)}</Space> : <Typography.Text type="secondary">{t("未加入定价分组")}</Typography.Text>;
            } },
            ...(!presentation?.fixedInventoryMode ? [{ title: t("库存方式"), dataIndex: "inventoryMode", render: (value: string) => <Tag color={value === "bundle" ? "purple" : value === "quantity" ? "gold" : "blue"}>{t(inventoryLabels[value] ?? value)}</Tag> }] : []),
            ...(!presentation?.fixedUnit ? [{ title: t("单位"), dataIndex: "unit" }] : []),
            ...(category?.supportedInventoryModes.includes(RentalInventoryMode.Bundle) ? [{ title: t("套装组成"), dataIndex: "bundleComponents", render: (items: RentalItemGroup["bundleComponents"]) => items?.length ? items.map((item) => `${item.itemGroupName}×${item.quantity}${item.substitutionGroup ? ` [${item.substitutionGroup}${item.optional ? `·${t("候选")}` : `·${t("默认")}`}]` : ""}`).join("，") : "-" }] : []),
            { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{t(value === "enabled" ? "启用" : "停用")}</Tag> },
            { title: t("操作"), fixed: "right", render: (_, row) => canManage ? <Button type="link" onClick={() => openEditor(row)}>{t("编辑")}</Button> : "-" }
          ]} />
        </QueryState>
      </Card>

      <Drawer title={editing ? `${t("编辑")}${itemGroupLabel}` : `${t("新增")}${itemGroupLabel}`} size={760} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<SaveButton label={t("保存")} form={form} pending={save.isPending} onSave={(values) => save.mutateAsync({ ...values, inventoryMode: presentation?.fixedInventoryMode ?? values.inventoryMode, unit: presentation?.fixedUnit ?? values.unit, id: editing?.id })} />}>
        <Form<SaveRentalItemGroupRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, inventoryMode: presentation?.fixedInventoryMode ?? values.inventoryMode, unit: presentation?.fixedUnit ?? values.unit, id: editing?.id })}>
          <Card size="small" title={`${itemGroupLabel}${t("照片")}`} style={{ marginBottom: 16 }}>
            <Typography.Paragraph type="secondary">{t("上传型号的标准展示图，第一张作为列表封面；具体资产的实拍、状态和损伤照片在资产管理中维护。")}</Typography.Paragraph>
            {editing?.images?.length ? <Space size={[12, 12]} wrap style={{ marginBottom: 12 }}>{editing.images.map((image) => <div key={image.id} style={{ position: "relative" }}><ItemGroupPhoto groupId={editing.id} image={image} size={112} />{image.isCover && <Tag color="processing" style={{ position: "absolute", left: 6, top: 6 }}>{t("封面")}</Tag>}<Button danger size="small" shape="circle" icon={<DeleteOutlined />} loading={removeImage.isPending} onClick={() => removeImage.mutate({ groupId: editing.id, imageId: image.id })} style={{ position: "absolute", right: 6, top: 6 }} /></div>)}</Space> : null}
            <Upload
              accept="image/jpeg,image/png,image/webp"
              multiple
              listType="picture"
              fileList={pendingFiles}
              maxCount={Math.max(0, 6 - (editing?.images?.length ?? 0))}
              beforeUpload={(file) => {
                if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { message.error(t("只支持 JPG、PNG 或 WebP 图片")); return Upload.LIST_IGNORE; }
                if (file.size > 5 * 1024 * 1024) { message.error(t("单张图片不能超过 5MB")); return Upload.LIST_IGNORE; }
                return false;
              }}
              onChange={({ fileList }) => setPendingFiles(fileList)}
            >
              {(editing?.images?.length ?? 0) + pendingFiles.length < 6 && <Button icon={<UploadOutlined />}>{t("选择照片")}</Button>}
            </Upload>
            {pendingFiles.length > 0 && <Typography.Text type="secondary">{t("所选照片将在点击右上角“保存”后上传。")}</Typography.Text>}
          </Card>
          <Card size="small" title={t("型号基本资料")} style={{ marginBottom: 16 }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label={t(presentation?.itemGroupCodeLabel ?? `${itemGroupLabel}${t("编码")}`)} rules={[{ required: true }]}><Input disabled={Boolean(editing)} placeholder={t("用于内部检索和接口引用")} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label={t(presentation?.itemGroupNameLabel ?? `${itemGroupLabel}${t("名称")}`)} extra={t("这是型号的显示名称，不是面向客户的定价组名称。")} rules={[{ required: true }]}><Input placeholder={t(presentation?.itemGroupNamePlaceholder ?? "")} /></Form.Item></Col>
            {presentation?.fixedInventoryMode ? <Form.Item name="inventoryMode" hidden><Input /></Form.Item> : <Col span={12}><Form.Item name="inventoryMode" label={t("库存方式")} rules={[{ required: true }]}><Select disabled={Boolean(editing)} options={category?.supportedInventoryModes.map((value) => ({ value, label: t(inventoryLabels[value] ?? value) }))} /></Form.Item></Col>}
            {presentation?.fixedUnit ? <Form.Item name="unit" hidden><Input /></Form.Item> : <Col span={12}><Form.Item name="unit" label={t("计量单位")} rules={[{ required: true }]}><Input placeholder={t("台、套、顶、辆")} /></Form.Item></Col>}
          </Row>
          {presentation?.fixedInventoryMode && <Typography.Text type="secondary">{locale === "en-US" ? `${t("固定按“")}${t(inventoryLabels[presentation.fixedInventoryMode])}${t(" / ")}${presentation.fixedUnit}${t("”管理，具体")}${t(profile.data?.terminology.assetLabel ?? "资产")}${t("在“")}${resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? t("资产管理")}${t("”中登记。")}` : `该品类固定按“${inventoryLabels[presentation.fixedInventoryMode]} / ${presentation.fixedUnit}”管理，具体${profile.data?.terminology.assetLabel ?? "资产"}在“${resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产管理"}”中登记。`}</Typography.Text>}
          </Card>
          <Card size="small" title={`${t(category?.name ?? "品类")}${t("厂商与型号规格")}`} style={{ marginBottom: 16 }}>
            <Row gutter={12}>{groupFields.map((field) => <Col span={12} key={field.code}><Form.Item name={["attributes", field.code]} label={t(field.label)} extra={field.code === "securityRiskLevel" ? t("未分级商品按未获风控许可处理；会员押金或预授权减免只对空间规则明确允许的等级生效。") : field.unique ? t("当前经营空间内不可重复") : undefined} rules={[{ required: field.required }]} valuePropName={field.type === "boolean" ? "checked" : "value"}><AttributeInput field={field} /></Form.Item></Col>)}</Row>
          </Card>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.inventoryMode !== current.inventoryMode}>{({ getFieldValue }) => getFieldValue("inventoryMode") === RentalInventoryMode.Bundle && (
            <Card size="small" title={t("套装组成")} style={{ marginBottom: 16 }}>
              <Form.List name="bundleComponents">{(fields, { add, remove }) => <Space orientation="vertical" style={{ width: "100%" }}>{fields.map((field) => <Row gutter={8} key={field.key}><Col span={9}><Form.Item {...field} name={[field.name, "itemGroupId"]} rules={[{ required: true }]}><Select placeholder={t("选择组成商品")} options={(groups.data ?? []).filter((item) => item.id !== editing?.id && item.inventoryMode !== RentalInventoryMode.Bundle).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item></Col><Col span={4}><Form.Item {...field} name={[field.name, "quantity"]} rules={[{ required: true }]}><InputNumber min={1} precision={0} placeholder={t("数量")} style={{ width: "100%" }} /></Form.Item></Col><Col span={5}><Form.Item {...field} name={[field.name, "substitutionGroup"]}><Input placeholder={t("替代组编码")} /></Form.Item></Col><Col span={4}><Form.Item {...field} name={[field.name, "optional"]} valuePropName="checked"><Switch checkedChildren={t("候选")} unCheckedChildren={t("默认")} /></Form.Item></Col><Col span={2}><Button danger type="text" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} /></Col></Row>)}<Alert type="info" showIcon title={t("替代组规则")} description={t("同一替代组必须配置一个默认组成和至少一个替代候选；订单确认后、配货前可以在组内替换。")} /><Button block type="dashed" onClick={() => add({ quantity: 1, optional: false })} icon={<PlusOutlined />}>{t("增加组成项")}</Button></Space>}</Form.List>
            </Card>
          )}</Form.Item>
          <Form.Item name="description" label={t("说明")}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}><Select options={[{ value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item>
        </Form>
      </Drawer>
    </>
  );
}

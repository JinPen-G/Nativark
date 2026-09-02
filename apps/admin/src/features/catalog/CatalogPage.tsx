import { MinusCircleOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { RentalInventoryMode, type RentalAttributeDefinition, type RentalItemGroup, type SaveRentalItemGroupRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { resolveTenantNavigationLabels } from "@/app/navigation-terminology";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const inventoryLabels: Record<string, string> = { serialized: "序列化资产", quantity: "数量库存", bundle: "套装" };

function AttributeInput({ field }: { field: RentalAttributeDefinition }) {
  if (field.type === "number") return <InputNumber min={0} suffix={field.unit} style={{ width: "100%" }} />;
  if (field.type === "select") return <Select options={field.options?.map((value) => ({ value, label: value }))} />;
  if (field.type === "boolean") return <Switch />;
  return <Input type={field.type === "date" ? "date" : undefined} />;
}

export function CatalogPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((state) => state.hasPermission("rental-core:catalog:manage") || state.hasPermission("store-rental:vehicle-group:manage"));
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<RentalItemGroup>();
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const itemGroupLabel = profile.data?.terminology.itemGroupLabel ?? "产品型号";
  const save = useMutation({
    mutationFn: rentalCoreApi.saveItemGroup,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "groups"] });
      setDrawerOpen(false);
      setEditing(undefined);
      form.resetFields();
      message.success(`${profile.data?.terminology.itemGroupLabel ?? "商品"}已保存`);
    },
    onError: () => message.error("保存失败，请检查编码、库存模式、品类字段和套装组成")
  });
  const rows = useMemo(() => (groups.data ?? []).filter((item) => `${item.code}${item.name}${Object.values(item.attributes).join("")}`.toLowerCase().includes(keyword.toLowerCase())), [groups.data, keyword]);

  function openEditor(record?: RentalItemGroup) {
    setEditing(record);
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
      <PageHeader title={resolveTenantNavigationLabels(profile.data?.terminology).routes.itemGroups ?? "商品目录"} description={presentation?.itemGroupDescription ?? "按经营品类维护产品型号、共享规格和库存形态；商业定价分组与具体资产在各自页面维护。"} extra={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增{itemGroupLabel}</Button> : undefined} />
      <Alert type="info" showIcon title={`${itemGroupLabel}是厂商产品主档，不是定价分组`} description={`这里保存厂商、品牌、型号和共享规格；${profile.data?.terminology.identifierLabel ?? "资产编号"}等单件信息在“${resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产管理"}”登记，面向客户的商业分组在“${resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ?? "定价分组"}”建立。`} style={{ marginBottom: 16 }} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space style={{ marginBottom: 16 }}><Input allowClear prefix={<SearchOutlined />} placeholder="搜索编码、名称或规格" value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 300 }} /></Space>
        <QueryState loading={groups.isLoading || pricingGroups.isLoading || profile.isLoading || categories.isLoading} error={groups.error || pricingGroups.error || profile.error || categories.error}>
          <Table<RentalItemGroup> rowKey="id" dataSource={rows} scroll={{ x: 960 }} columns={[
            { title: itemGroupLabel, fixed: "left", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code}</span></> },
            ...summaryFields.map((field) => ({ title: field.label, render: (_: unknown, row: RentalItemGroup) => String(row.attributes[field.code] ?? "-") })),
            { title: resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ?? "所属定价分组", render: (_, row) => {
              const memberships = (pricingGroups.data ?? []).filter((pricingGroup) => pricingGroup.memberItemGroupIds.includes(row.id));
              return memberships.length ? <Space size={[4, 4]} wrap>{memberships.map((pricingGroup) => <Tag color="blue" key={pricingGroup.id}>{pricingGroup.name}</Tag>)}</Space> : <Typography.Text type="secondary">未加入定价分组</Typography.Text>;
            } },
            ...(!presentation?.fixedInventoryMode ? [{ title: "库存方式", dataIndex: "inventoryMode", render: (value: string) => <Tag color={value === "bundle" ? "purple" : value === "quantity" ? "gold" : "blue"}>{inventoryLabels[value] ?? value}</Tag> }] : []),
            ...(!presentation?.fixedUnit ? [{ title: "单位", dataIndex: "unit" }] : []),
            ...(category?.supportedInventoryModes.includes(RentalInventoryMode.Bundle) ? [{ title: "套装组成", dataIndex: "bundleComponents", render: (items: RentalItemGroup["bundleComponents"]) => items?.length ? items.map((item) => `${item.itemGroupName}×${item.quantity}${item.substitutionGroup ? ` [${item.substitutionGroup}${item.optional ? "·候选" : "·默认"}]` : ""}`).join("，") : "-" }] : []),
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value === "enabled" ? "启用" : "停用"}</Tag> },
            { title: "操作", fixed: "right", render: (_, row) => canManage ? <Button type="link" onClick={() => openEditor(row)}>编辑</Button> : "-" }
          ]} />
        </QueryState>
      </Card>

      <Drawer title={editing ? `编辑${itemGroupLabel}` : `新增${itemGroupLabel}`} size={760} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
        <Form<SaveRentalItemGroupRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, inventoryMode: presentation?.fixedInventoryMode ?? values.inventoryMode, unit: presentation?.fixedUnit ?? values.unit, id: editing?.id })}>
          <Card size="small" title="型号基本资料" style={{ marginBottom: 16 }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label={presentation?.itemGroupCodeLabel ?? `${itemGroupLabel}编码`} rules={[{ required: true }]}><Input disabled={Boolean(editing)} placeholder="用于内部检索和接口引用" /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label={presentation?.itemGroupNameLabel ?? `${itemGroupLabel}名称`} extra="这是型号的显示名称，不是面向客户的定价组名称。" rules={[{ required: true }]}><Input placeholder={presentation?.itemGroupNamePlaceholder} /></Form.Item></Col>
            {presentation?.fixedInventoryMode ? <Form.Item name="inventoryMode" hidden><Input /></Form.Item> : <Col span={12}><Form.Item name="inventoryMode" label="库存方式" rules={[{ required: true }]}><Select disabled={Boolean(editing)} options={category?.supportedInventoryModes.map((value) => ({ value, label: inventoryLabels[value] ?? value }))} /></Form.Item></Col>}
            {presentation?.fixedUnit ? <Form.Item name="unit" hidden><Input /></Form.Item> : <Col span={12}><Form.Item name="unit" label="计量单位" rules={[{ required: true }]}><Input placeholder="台、套、顶、辆" /></Form.Item></Col>}
          </Row>
          {presentation?.fixedInventoryMode && <Typography.Text type="secondary">该品类固定按“{inventoryLabels[presentation.fixedInventoryMode]} / {presentation.fixedUnit}”管理，具体单车在车辆管理中登记。</Typography.Text>}
          </Card>
          <Card size="small" title={`${category?.name ?? "品类"}厂商与型号规格`} style={{ marginBottom: 16 }}>
            <Row gutter={12}>{groupFields.map((field) => <Col span={12} key={field.code}><Form.Item name={["attributes", field.code]} label={field.label} extra={field.unique ? "当前经营空间内不可重复" : undefined} rules={[{ required: field.required }]} valuePropName={field.type === "boolean" ? "checked" : "value"}><AttributeInput field={field} /></Form.Item></Col>)}</Row>
          </Card>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.inventoryMode !== current.inventoryMode}>{({ getFieldValue }) => getFieldValue("inventoryMode") === RentalInventoryMode.Bundle && (
            <Card size="small" title="套装组成" style={{ marginBottom: 16 }}>
              <Form.List name="bundleComponents">{(fields, { add, remove }) => <Space orientation="vertical" style={{ width: "100%" }}>{fields.map((field) => <Row gutter={8} key={field.key}><Col span={9}><Form.Item {...field} name={[field.name, "itemGroupId"]} rules={[{ required: true }]}><Select placeholder="选择组成商品" options={(groups.data ?? []).filter((item) => item.id !== editing?.id && item.inventoryMode !== RentalInventoryMode.Bundle).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item></Col><Col span={4}><Form.Item {...field} name={[field.name, "quantity"]} rules={[{ required: true }]}><InputNumber min={1} precision={0} placeholder="数量" style={{ width: "100%" }} /></Form.Item></Col><Col span={5}><Form.Item {...field} name={[field.name, "substitutionGroup"]}><Input placeholder="替代组编码" /></Form.Item></Col><Col span={4}><Form.Item {...field} name={[field.name, "optional"]} valuePropName="checked"><Switch checkedChildren="候选" unCheckedChildren="默认" /></Form.Item></Col><Col span={2}><Button danger type="text" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} /></Col></Row>)}<Alert type="info" showIcon title="替代组规则" description="同一替代组必须配置一个默认组成和至少一个替代候选；订单确认后、配货前可以在组内替换。" /><Button block type="dashed" onClick={() => add({ quantity: 1, optional: false })} icon={<PlusOutlined />}>增加组成项</Button></Space>}</Form.List>
            </Card>
          )}</Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item>
        </Form>
      </Drawer>
    </>
  );
}

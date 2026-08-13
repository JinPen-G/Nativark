import { MinusCircleOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { RentalInventoryMode, type RentalAttributeDefinition, type RentalItemGroup, type SaveRentalItemGroupRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tag } from "antd";
import { useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

const inventoryLabels: Record<string, string> = { serialized: "序列化资产", quantity: "数量库存", bundle: "套装" };

function AttributeInput({ field }: { field: RentalAttributeDefinition }) {
  if (field.type === "number") return <InputNumber min={0} addonAfter={field.unit} style={{ width: "100%" }} />;
  if (field.type === "select") return <Select options={field.options?.map((value) => ({ value, label: value }))} />;
  if (field.type === "boolean") return <Switch />;
  return <Input />;
}

export function CatalogPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<RentalItemGroup>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm<SaveRentalItemGroupRequest>();
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const categories = useQuery({ queryKey: ["rental-core", "categories"], queryFn: rentalCoreApi.categories });
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const groupFields = category?.businessModel.assetFields.filter((field) => field.scope === "item_group") ?? [];
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
      inventoryMode: category?.supportedInventoryModes[0] ?? RentalInventoryMode.Serialized,
      unit: "件",
      description: "",
      attributes: {},
      bundleComponents: [],
      status: "enabled"
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title={profile.data?.terminology.itemGroupLabel ?? "商品目录"} description="按经营品类维护商品型号、库存方式、规格字段和套装组成。" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增{profile.data?.terminology.itemGroupLabel ?? "商品"}</Button>} />
      <Alert type="info" showIcon message={`${category?.name ?? "当前品类"}商品模型`} description="厂商、型号等共享属性保存在商品型号；车牌、SN 等单件信息保存在资产实例；基础价格不再直接写进商品主数据。" style={{ marginBottom: 16 }} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space style={{ marginBottom: 16 }}><Input allowClear prefix={<SearchOutlined />} placeholder="搜索编码、名称或规格" value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 300 }} /></Space>
        <QueryState loading={groups.isLoading || profile.isLoading || categories.isLoading} error={groups.error || profile.error || categories.error}>
          <Table<RentalItemGroup> rowKey="id" dataSource={rows} scroll={{ x: 960 }} columns={[
            { title: profile.data?.terminology.itemGroupLabel ?? "商品", fixed: "left", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code}</span></> },
            { title: "厂商 / 型号", render: (_, row) => [row.attributes.manufacturer, row.attributes.brand, row.attributes.model].filter(Boolean).join(" · ") || "-" },
            { title: "库存方式", dataIndex: "inventoryMode", render: (value) => <Tag color={value === "bundle" ? "purple" : value === "quantity" ? "gold" : "blue"}>{inventoryLabels[value] ?? value}</Tag> },
            { title: "单位", dataIndex: "unit" },
            { title: "套装组成", dataIndex: "bundleComponents", render: (items) => items?.length ? items.map((item: { itemGroupName: string; quantity: number }) => `${item.itemGroupName}×${item.quantity}`).join("，") : "-" },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value === "enabled" ? "启用" : "停用"}</Tag> },
            { title: "操作", fixed: "right", render: (_, row) => <Button type="link" onClick={() => openEditor(row)}>编辑</Button> }
          ]} />
        </QueryState>
      </Card>

      <Drawer title={editing ? `编辑${profile.data?.terminology.itemGroupLabel ?? "商品"}` : `新增${profile.data?.terminology.itemGroupLabel ?? "商品"}`} width={680} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
        <Form<SaveRentalItemGroupRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, id: editing?.id })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="商品编码" rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="inventoryMode" label="库存方式" rules={[{ required: true }]}><Select disabled={Boolean(editing)} options={category?.supportedInventoryModes.map((value) => ({ value, label: inventoryLabels[value] ?? value }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="unit" label="计量单位" rules={[{ required: true }]}><Input placeholder="台、套、顶、辆" /></Form.Item></Col>
          </Row>
          <Card size="small" title={`${category?.name ?? "品类"}规格字段`} style={{ marginBottom: 16 }}>
            <Row gutter={12}>{groupFields.map((field) => <Col span={12} key={field.code}><Form.Item name={["attributes", field.code]} label={field.label} rules={[{ required: field.required }]} valuePropName={field.type === "boolean" ? "checked" : "value"}><AttributeInput field={field} /></Form.Item></Col>)}</Row>
          </Card>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.inventoryMode !== current.inventoryMode}>{({ getFieldValue }) => getFieldValue("inventoryMode") === RentalInventoryMode.Bundle && (
            <Card size="small" title="套装组成" style={{ marginBottom: 16 }}>
              <Form.List name="bundleComponents">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: "100%" }}>{fields.map((field) => <Row gutter={8} key={field.key}><Col span={14}><Form.Item {...field} name={[field.name, "itemGroupId"]} rules={[{ required: true }]}><Select placeholder="选择组成商品" options={(groups.data ?? []).filter((item) => item.id !== editing?.id && item.inventoryMode !== RentalInventoryMode.Bundle).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item></Col><Col span={6}><Form.Item {...field} name={[field.name, "quantity"]} rules={[{ required: true }]}><InputNumber min={1} precision={0} placeholder="数量" style={{ width: "100%" }} /></Form.Item></Col><Col span={4}><Button danger type="text" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} /></Col></Row>)}<Button block type="dashed" onClick={() => add({ quantity: 1 })} icon={<PlusOutlined />}>增加组成项</Button></Space>}</Form.List>
            </Card>
          )}</Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item>
        </Form>
      </Drawer>
    </>
  );
}

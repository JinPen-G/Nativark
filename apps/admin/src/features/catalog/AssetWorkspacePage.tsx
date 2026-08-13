import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { RentalAssetStatus, RentalInventoryMode, type RentalAsset, type RentalAttributeDefinition, type RentalStockBalance, type SaveRentalAssetRequest, type SaveRentalStockBalanceRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tabs, Tag } from "antd";
import { useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const statusMap: Record<string, { label: string; color: string }> = {
  available: { label: "可用", color: "success" }, reserved: { label: "已预占", color: "processing" }, rented: { label: "租赁中", color: "blue" },
  inspection: { label: "检查中", color: "orange" }, maintenance: { label: "维护中", color: "warning" }, disabled: { label: "停用", color: "default" }
};

function AttributeInput({ field }: { field: RentalAttributeDefinition }) {
  if (field.type === "number") return <InputNumber min={0} addonAfter={field.unit} style={{ width: "100%" }} />;
  if (field.type === "select") return <Select options={field.options?.map((value) => ({ value, label: value }))} />;
  if (field.type === "boolean") return <Switch />;
  return <Input placeholder={field.type === "date" ? "YYYY-MM-DD" : undefined} />;
}

export function AssetWorkspacePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((state) => state.hasPermission("store-rental:vehicle:manage"));
  const [activeTab, setActiveTab] = useState<"assets" | "stock">("assets");
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<RentalAsset>();
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [stockDrawerOpen, setStockDrawerOpen] = useState(false);
  const [assetForm] = Form.useForm<SaveRentalAssetRequest>();
  const [stockForm] = Form.useForm<SaveRentalStockBalanceRequest>();
  const assets = useQuery({ queryKey: ["rental-core", "assets"], queryFn: rentalCoreApi.assets });
  const stocks = useQuery({ queryKey: ["rental-core", "stocks"], queryFn: rentalCoreApi.stockBalances });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const categories = useQuery({ queryKey: ["rental-core", "categories"], queryFn: rentalCoreApi.categories });
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const assetFields = category?.businessModel.assetFields.filter((field) => field.scope === "asset" && !["licensePlate", "vin", "serialNo"].includes(field.code)) ?? [];
  const saveAsset = useMutation({ mutationFn: rentalCoreApi.saveAsset, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "assets"] }); setAssetDrawerOpen(false); setEditing(undefined); assetForm.resetFields(); message.success("资产已保存"); }, onError: () => message.error("资产保存失败，请检查编号、商品和履约地点") });
  const saveStock = useMutation({ mutationFn: rentalCoreApi.saveStockBalance, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "stocks"] }); setStockDrawerOpen(false); stockForm.resetFields(); message.success("库存余额已保存"); }, onError: () => message.error("库存保存失败，请检查数量和履约地点") });
  const assetRows = useMemo(() => (assets.data ?? []).filter((asset) => !keyword || `${asset.assetNo}${asset.serialNo}${asset.itemGroupName}${asset.locationName}${Object.values(asset.attributes).join("")}`.toLowerCase().includes(keyword.toLowerCase())), [assets.data, keyword]);
  const stockRows = useMemo(() => (stocks.data ?? []).filter((stock) => !keyword || `${stock.itemGroupCode}${stock.itemGroupName}${stock.locationName}`.toLowerCase().includes(keyword.toLowerCase())), [stocks.data, keyword]);
  const serializedGroups = (groups.data ?? []).filter((group) => group.inventoryMode === RentalInventoryMode.Serialized && group.status === "enabled");
  const quantityGroups = (groups.data ?? []).filter((group) => group.inventoryMode === RentalInventoryMode.Quantity && group.status === "enabled");

  function openAssetEditor(record?: RentalAsset) {
    setEditing(record);
    assetForm.setFieldsValue(record ?? { itemGroupId: serializedGroups[0]?.id ?? "", assetNo: "", serialNo: "", locationId: locations.data?.[0]?.id ?? "", status: RentalAssetStatus.Available, attributes: {} });
    setAssetDrawerOpen(true);
  }

  function openStockEditor(record?: RentalStockBalance) {
    stockForm.setFieldsValue(record ? { itemGroupId: record.itemGroupId, locationId: record.locationId, onHandQuantity: record.onHandQuantity, maintenanceQuantity: record.maintenanceQuantity } : { itemGroupId: quantityGroups[0]?.id ?? "", locationId: locations.data?.[0]?.id ?? "", onHandQuantity: 0, maintenanceQuantity: 0 });
    setStockDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title="资产与库存" description="统一维护序列化资产和数量库存，字段由租户经营品类 schema 决定。" extra={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={() => activeTab === "assets" ? openAssetEditor() : openStockEditor()}>{activeTab === "assets" ? `新增${profile.data?.terminology.assetLabel ?? "资产"}` : "维护数量库存"}</Button> : undefined} />
      <Tabs className="standalone-tabs" activeKey={activeTab} onChange={(key) => setActiveTab(key as "assets" | "stock")} items={[{ key: "assets", label: `序列化资产（${assets.data?.length ?? 0}）` }, { key: "stock", label: `数量库存（${stocks.data?.length ?? 0}）` }]} />
      <Alert type="info" showIcon message={`${category?.name ?? "当前品类"}资产模型`} description={`独立资产使用“${profile.data?.terminology.identifierLabel ?? "资产编号"}”；厂商和型号在商品目录维护，领取/归还使用量属于履约记录。`} style={{ marginBottom: 16 }} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space wrap style={{ marginBottom: 16 }}><Input allowClear prefix={<SearchOutlined />} placeholder="编号、商品或履约地点" value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 300 }} /></Space>
        <QueryState loading={assets.isLoading || stocks.isLoading || groups.isLoading || locations.isLoading || profile.isLoading || categories.isLoading} error={assets.error || stocks.error || groups.error || locations.error || profile.error || categories.error}>
          {activeTab === "assets" ? <Table<RentalAsset> rowKey="id" dataSource={assetRows} scroll={{ x: 960 }} columns={[
            { title: profile.data?.terminology.identifierLabel ?? "资产编号", dataIndex: "assetNo", fixed: "left", render: (value) => <b>{value}</b> },
            { title: "序列号", dataIndex: "serialNo", render: (value) => value || "-" },
            { title: profile.data?.terminology.itemGroupLabel ?? "商品", render: (_, row) => <>{row.itemGroupName}<br /><span className="muted">{row.itemGroupCode}</span></> },
            { title: profile.data?.terminology.fulfillmentLabel ?? "履约地点", dataIndex: "locationName" },
            { title: "品类属性", dataIndex: "attributes", render: (value) => Object.entries(value ?? {}).map(([key, item]) => `${category?.businessModel.assetFields.find((field) => field.code === key)?.label ?? key}: ${String(item)}`).join(" · ") || "-" },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={statusMap[value]?.color}>{statusMap[value]?.label ?? value}</Tag> },
            { title: "操作", fixed: "right", render: (_, row) => canManage ? <Button type="link" onClick={() => openAssetEditor(row)}>编辑</Button> : "-" }
          ]} /> : <Table<RentalStockBalance> rowKey="id" dataSource={stockRows} columns={[
            { title: "商品", render: (_, row) => <><b>{row.itemGroupName}</b><br /><span className="muted">{row.itemGroupCode}</span></> },
            { title: profile.data?.terminology.fulfillmentLabel ?? "履约地点", dataIndex: "locationName" },
            { title: "在手", dataIndex: "onHandQuantity", align: "right" },
            { title: "已预占", dataIndex: "reservedQuantity", align: "right" },
            { title: "维护/清洁", dataIndex: "maintenanceQuantity", align: "right" },
            { title: "可用", dataIndex: "availableQuantity", align: "right", render: (value) => <b>{value}</b> },
            { title: "操作", render: (_, row) => canManage ? <Button type="link" onClick={() => openStockEditor(row)}>调整库存</Button> : "-" }
          ]} />}
        </QueryState>
      </Card>

      <Drawer title={editing ? `编辑${profile.data?.terminology.assetLabel ?? "资产"}` : `新增${profile.data?.terminology.assetLabel ?? "资产"}`} width={640} open={assetDrawerOpen} destroyOnHidden onClose={() => setAssetDrawerOpen(false)} extra={<Button type="primary" loading={saveAsset.isPending} onClick={() => assetForm.submit()}>保存</Button>}>
        <Form<SaveRentalAssetRequest> form={assetForm} layout="vertical" onFinish={(values) => saveAsset.mutate({ ...values, id: editing?.id })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="assetNo" label={profile.data?.terminology.identifierLabel ?? "资产编号"} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="serialNo" label={profile.data?.categoryCode === "vehicle" ? "VIN" : "序列号"} rules={[{ required: profile.data?.categoryCode === "vehicle" || profile.data?.categoryCode === "camera" }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="itemGroupId" label={profile.data?.terminology.itemGroupLabel ?? "商品"} rules={[{ required: true }]}><Select disabled={Boolean(editing)} showSearch optionFilterProp="label" options={serializedGroups.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="locationId" label={profile.data?.terminology.fulfillmentLabel ?? "履约地点"} rules={[{ required: true }]}><Select options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={Object.entries(statusMap).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item></Col>
          </Row>
          {assetFields.length > 0 && <Card size="small" title="品类资产字段"><Row gutter={12}>{assetFields.map((field) => <Col span={12} key={field.code}><Form.Item name={["attributes", field.code]} label={field.label} rules={[{ required: field.required }]} valuePropName={field.type === "boolean" ? "checked" : "value"}><AttributeInput field={field} /></Form.Item></Col>)}</Row></Card>}
        </Form>
      </Drawer>

      <Drawer title="维护数量库存" width={520} open={stockDrawerOpen} destroyOnHidden onClose={() => setStockDrawerOpen(false)} extra={<Button type="primary" loading={saveStock.isPending} onClick={() => stockForm.submit()}>保存</Button>}>
        <Form<SaveRentalStockBalanceRequest> form={stockForm} layout="vertical" onFinish={(values) => saveStock.mutate(values)}>
          <Form.Item name="itemGroupId" label="数量型商品" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={quantityGroups.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
          <Form.Item name="locationId" label={profile.data?.terminology.fulfillmentLabel ?? "履约地点"} rules={[{ required: true }]}><Select options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="onHandQuantity" label="在手数量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name="maintenanceQuantity" label="维护/清洁数量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col></Row>
          <Alert type="warning" showIcon message="库存调整目前保存余额" description="正式生产还需库存流水、批次、盘点和并发锁；服务端会按在手、维护和订单预占计算可用数量。" />
        </Form>
      </Drawer>
    </>
  );
}

import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { RentalAssetStatus, RentalInventoryMode, type RentalAsset, type RentalAttributeDefinition, type RentalStockBalance, type SaveRentalAssetRequest, type SaveRentalStockBalanceRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tabs, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { resolveTenantNavigationLabels } from "@/app/navigation-terminology";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { ItemGroupPhoto } from "./ItemGroupPhoto";

const statusMap: Record<string, { label: string; color: string }> = {
  available: { label: "可用", color: "success" }, reserved: { label: "已预占", color: "processing" }, rented: { label: "租赁中", color: "blue" },
  inspection: { label: "检查中", color: "orange" }, maintenance: { label: "维护中", color: "warning" }, disabled: { label: "停用", color: "default" }
};

function AttributeInput({ field }: { field: RentalAttributeDefinition }) {
  if (field.type === "number") return <InputNumber min={0} suffix={field.unit} style={{ width: "100%" }} />;
  if (field.type === "select") return <Select options={field.options?.map((value) => ({ value, label: value }))} />;
  if (field.type === "boolean") return <Switch />;
  return <Input type={field.type === "date" ? "date" : undefined} />;
}

export function AssetWorkspacePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((state) => state.hasPermission("rental-core:asset:manage") || state.hasPermission("store-rental:vehicle:manage"));
  const [activeTab, setActiveTab] = useState<"assets" | "stock">("assets");
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<RentalAsset>();
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [stockDrawerOpen, setStockDrawerOpen] = useState(false);
  const [assetForm] = Form.useForm<SaveRentalAssetRequest>();
  const [stockForm] = Form.useForm<SaveRentalStockBalanceRequest>();
  const selectedItemGroupId = Form.useWatch("itemGroupId", assetForm);
  const assets = useQuery({ queryKey: ["rental-core", "assets"], queryFn: rentalCoreApi.assets });
  const stocks = useQuery({ queryKey: ["rental-core", "stocks"], queryFn: rentalCoreApi.stockBalances });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const categories = useQuery({ queryKey: ["rental-core", "categories"], queryFn: rentalCoreApi.categories });
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const presentation = category?.businessModel.catalogPresentation;
  const serialNoField = category?.businessModel.assetFields.find((field) => field.scope === "asset" && field.code === "serialNo");
  const assetFields = category?.businessModel.assetFields.filter((field) => field.scope === "asset" && field.code !== "serialNo") ?? [];
  const summaryAssetFields = (presentation?.assetSummaryFields ?? assetFields.map((field) => field.code))
    .map((code) => assetFields.find((field) => field.code === code))
    .filter((field): field is RentalAttributeDefinition => Boolean(field));
  const supportsAssets = category?.supportedInventoryModes.includes(RentalInventoryMode.Serialized) ?? true;
  const supportsStock = category?.supportedInventoryModes.includes(RentalInventoryMode.Quantity) ?? true;
  const visibleTabs = [
    supportsAssets ? { key: "assets", label: `序列化资产（${assets.data?.length ?? 0}）` } : undefined,
    supportsStock ? { key: "stock", label: `数量库存（${stocks.data?.length ?? 0}）` } : undefined
  ].filter((item): item is { key: string; label: string } => Boolean(item));
  const saveAsset = useMutation({ mutationFn: rentalCoreApi.saveAsset, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "assets"] }); setAssetDrawerOpen(false); setEditing(undefined); assetForm.resetFields(); message.success("资产已保存"); }, onError: () => message.error("资产保存失败，请检查编号、商品和履约地点") });
  const saveStock = useMutation({ mutationFn: rentalCoreApi.saveStockBalance, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "stocks"] }); setStockDrawerOpen(false); stockForm.resetFields(); message.success("库存余额已保存"); }, onError: () => message.error("库存保存失败，请检查数量和履约地点") });
  const assetRows = useMemo(() => (assets.data ?? []).filter((asset) => !keyword || `${asset.assetNo}${asset.serialNo}${asset.itemGroupName}${asset.locationName}${Object.values(asset.attributes).join("")}`.toLowerCase().includes(keyword.toLowerCase())), [assets.data, keyword]);
  const stockRows = useMemo(() => (stocks.data ?? []).filter((stock) => !keyword || `${stock.itemGroupCode}${stock.itemGroupName}${stock.locationName}`.toLowerCase().includes(keyword.toLowerCase())), [stocks.data, keyword]);
  const serializedGroups = (groups.data ?? []).filter((group) => group.inventoryMode === RentalInventoryMode.Serialized && group.status === "enabled");
  const quantityGroups = (groups.data ?? []).filter((group) => group.inventoryMode === RentalInventoryMode.Quantity && group.status === "enabled");
  const selectedItemGroup = (groups.data ?? []).find((group) => group.id === selectedItemGroupId);
  const selectedItemGroupCover = selectedItemGroup?.images?.find((image) => image.isCover) ?? selectedItemGroup?.images?.[0];

  useEffect(() => {
    if (category && !supportsAssets && supportsStock) setActiveTab("stock");
    if (category && supportsAssets && !supportsStock) setActiveTab("assets");
  }, [category, supportsAssets, supportsStock]);

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
      <PageHeader title={resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产与库存"} description={presentation?.assetDescription ?? "维护每件序列化资产或各地点的数量库存；厂商型号等共享资料由产品型号主档提供。"} note={{ title: `${profile.data?.terminology.assetLabel ?? category?.name ?? "当前品类资产"}是具体可交付实体`, description: `每条独立资产必须关联一个“${profile.data?.terminology.itemGroupLabel ?? "产品型号"}”；厂商和型号不在这里重复填写，领取/归还使用量属于订单履约记录。` }} extra={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={() => activeTab === "assets" ? openAssetEditor() : openStockEditor()}>{activeTab === "assets" ? `新增${profile.data?.terminology.assetLabel ?? "资产"}` : "维护数量库存"}</Button> : undefined} />
      {visibleTabs.length > 1 && <Tabs className="standalone-tabs" activeKey={activeTab} onChange={(key) => setActiveTab(key as "assets" | "stock")} items={visibleTabs} />}
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space wrap style={{ marginBottom: 16 }}><Input allowClear prefix={<SearchOutlined />} placeholder={`${profile.data?.terminology.identifierLabel ?? "资产编号"}、车牌/VIN、型号或${profile.data?.terminology.fulfillmentLabel ?? "履约地点"}`} value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 360 }} /></Space>
        <QueryState loading={assets.isLoading || stocks.isLoading || groups.isLoading || locations.isLoading || profile.isLoading || categories.isLoading} error={assets.error || stocks.error || groups.error || locations.error || profile.error || categories.error}>
          {activeTab === "assets" ? <Table<RentalAsset> rowKey="id" dataSource={assetRows} scroll={{ x: 960 }} columns={[
            { title: `${profile.data?.terminology.itemGroupLabel ?? "产品型号"}照片`, width: 110, fixed: "left", render: (_, row) => {
              const group = (groups.data ?? []).find((item) => item.id === row.itemGroupId);
              const image = group?.images?.find((item) => item.isCover) ?? group?.images?.[0];
              return group && image ? <ItemGroupPhoto groupId={group.id} image={image} /> : <span className="muted">未上传</span>;
            } },
            { title: profile.data?.terminology.identifierLabel ?? "资产编号", dataIndex: "assetNo", fixed: "left", render: (value) => <b>{value}</b> },
            ...(serialNoField ? [{ title: serialNoField.label, dataIndex: "serialNo", render: (value: string | undefined) => value || "-" }] : []),
            { title: profile.data?.terminology.itemGroupLabel ?? "产品型号", render: (_, row) => <><b>{row.itemGroupName}</b><br /><span className="muted">{row.itemGroupCode}</span></> },
            ...summaryAssetFields.map((field) => ({ title: field.label, render: (_: unknown, row: RentalAsset) => String(row.attributes[field.code] ?? "-") })),
            { title: profile.data?.terminology.fulfillmentLabel ?? "履约地点", dataIndex: "locationName" },
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

      <Drawer title={editing ? `编辑${profile.data?.terminology.assetLabel ?? "资产"}` : `新增${profile.data?.terminology.assetLabel ?? "资产"}`} size={640} open={assetDrawerOpen} destroyOnHidden onClose={() => setAssetDrawerOpen(false)} extra={<Button type="primary" loading={saveAsset.isPending} onClick={() => assetForm.submit()}>保存</Button>}>
        <Form<SaveRentalAssetRequest> form={assetForm} layout="vertical" onFinish={(values) => saveAsset.mutate({ ...values, id: editing?.id })}>
          {selectedItemGroup && <Card size="small" title={`${profile.data?.terminology.itemGroupLabel ?? "产品型号"}照片`} style={{ marginBottom: 16 }}>
            {selectedItemGroupCover ? <Space align="start"><ItemGroupPhoto groupId={selectedItemGroup.id} image={selectedItemGroupCover} size={128} /><span className="muted">{selectedItemGroup.name}<br />照片来自{profile.data?.terminology.itemGroupLabel ?? "产品型号"}主档；该资产的实拍、状态和损伤照片将在具体资产档案中独立维护。</span></Space> : <Alert type="info" showIcon title={`该${profile.data?.terminology.itemGroupLabel ?? "产品型号"}尚未上传照片`} description={`请先到“${resolveTenantNavigationLabels(profile.data?.terminology).routes.itemGroups ?? "产品型号管理"}”上传标准展示图。`} />}
          </Card>}
          <Card size="small" title={`${profile.data?.terminology.assetLabel ?? "资产"}基本资料`} style={{ marginBottom: 16 }}>
            <Row gutter={12}>
            <Col span={12}><Form.Item name="itemGroupId" label={profile.data?.terminology.itemGroupLabel ?? "产品型号"} extra="厂商、品牌和型号从所选主档带入。" rules={[{ required: true }]}><Select disabled={Boolean(editing)} showSearch={{ optionFilterProp: "label" }} options={serializedGroups.map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="assetNo" label={profile.data?.terminology.identifierLabel ?? "资产编号"} rules={[{ required: true }]}><Input placeholder="内部管理编号" /></Form.Item></Col>
            {serialNoField && <Col span={12}><Form.Item name="serialNo" label={serialNoField.label} extra={serialNoField.unique ? "当前经营空间内不可重复" : undefined} rules={[{ required: serialNoField.required }]}><AttributeInput field={serialNoField} /></Form.Item></Col>}
            <Col span={12}><Form.Item name="locationId" label={profile.data?.terminology.fulfillmentLabel ?? "履约地点"} rules={[{ required: true }]}><Select options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={Object.entries(statusMap).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item></Col>
            </Row>
          </Card>
          {assetFields.length > 0 && <Card size="small" title={`${profile.data?.terminology.assetLabel ?? "资产"}识别信息`}><Row gutter={12}>{assetFields.map((field) => <Col span={12} key={field.code}><Form.Item name={["attributes", field.code]} label={field.label} extra={field.unique ? "当前经营空间内不可重复" : undefined} rules={[{ required: field.required }]} valuePropName={field.type === "boolean" ? "checked" : "value"}><AttributeInput field={field} /></Form.Item></Col>)}</Row></Card>}
        </Form>
      </Drawer>

      <Drawer title="维护数量库存" size={520} open={stockDrawerOpen} destroyOnHidden onClose={() => setStockDrawerOpen(false)} extra={<Button type="primary" loading={saveStock.isPending} onClick={() => stockForm.submit()}>保存</Button>}>
        <Form<SaveRentalStockBalanceRequest> form={stockForm} layout="vertical" onFinish={(values) => saveStock.mutate(values)}>
          <Form.Item name="itemGroupId" label="数量型商品" rules={[{ required: true }]}><Select showSearch={{ optionFilterProp: "label" }} options={quantityGroups.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
          <Form.Item name="locationId" label={profile.data?.terminology.fulfillmentLabel ?? "履约地点"} rules={[{ required: true }]}><Select options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="onHandQuantity" label="在手数量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name="maintenanceQuantity" label="维护/清洁数量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col></Row>
          <Alert type="warning" showIcon title="库存调整目前保存余额" description="正式生产还需库存流水、批次、盘点和并发锁；服务端会按在手、维护和订单预占计算可用数量。" />
        </Form>
      </Drawer>
    </>
  );
}

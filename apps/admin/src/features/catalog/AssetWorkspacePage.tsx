import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { VehicleInstanceSummary } from "@store-rental/shared";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

const statusMap: Record<string, { label: string; color: string }> = { idle: { label: "可用", color: "success" }, reserved: { label: "已占用", color: "processing" }, renting: { label: "履约中", color: "blue" }, controlled: { label: "受控", color: "orange" }, maintenance: { label: "维护中", color: "warning" }, disabled: { label: "停用", color: "default" } };

export function AssetWorkspacePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>();
  const [editing, setEditing] = useState<VehicleInstanceSummary>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm<VehicleInstanceSummary>();
  const query = useQuery({ queryKey: ["assets"], queryFn: () => api.assets({ page: 1, pageSize: 200 }) });
  const groups = useQuery({ queryKey: ["item-groups"], queryFn: api.itemGroups });
  const locations = useQuery({ queryKey: ["locations", "asset-editor"], queryFn: () => api.locations({ page: 1, pageSize: 200 }) });
  const save = useMutation({ mutationFn: api.saveAsset, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["assets"] }); setDrawerOpen(false); setEditing(undefined); form.resetFields(); message.success("资产已保存"); }, onError: () => message.error("资产保存失败，请检查编号、位置和状态") });
  const rows = useMemo(() => (query.data?.rows ?? []).filter((asset) => (!keyword || `${asset.licensePlate}${asset.vehicleGroupName}${asset.currentStoreName}`.toLowerCase().includes(keyword.toLowerCase())) && (!status || asset.operationStatus === status)), [query.data, keyword, status]);

  function openEditor(record?: VehicleInstanceSummary) {
    setEditing(record);
    form.setFieldsValue(record ?? {
      id: "",
      licensePlate: "",
      vin: "",
      vehicleGroupName: "",
      assetCompanyName: "自有资产",
      currentStoreName: "",
      currentStationName: "",
      operationStatus: "idle",
      enabled: true,
      currentServiceType: "STORE_STANDARD",
      serviceTypes: ["STORE_STANDARD"],
      mileage: 0,
      color: "",
      isSpecial: false
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title="资产与库存" description="管理可租资产、当前位置和可用状态。当前资产来自车辆实例兼容投影。" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增资产</Button>} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space wrap style={{ marginBottom: 16 }}><Input allowClear prefix={<SearchOutlined />} placeholder="资产编号、标的分组、网点" value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 280 }} /><Select allowClear placeholder="全部状态" style={{ width: 150 }} value={status} onChange={setStatus} options={Object.entries(statusMap).map(([value, item]) => ({ value, label: item.label }))} /></Space>
        <QueryState loading={query.isLoading} error={query.error}>
          <Table rowKey="id" dataSource={rows} scroll={{ x: 1150 }} columns={[
            { title: "资产编号", dataIndex: "licensePlate", fixed: "left", render: (value) => <b>{value}</b> },
            { title: "标的分组", dataIndex: "vehicleGroupName" },
            { title: "当前网点", render: (_, record) => <span>{record.currentStoreName}<br /><span className="muted">{record.currentStationName}</span></span> },
            { title: "使用量", dataIndex: "mileage", align: "right", render: (value) => `${Number(value).toLocaleString()}（当前为车辆里程）` },
            { title: "状态", dataIndex: "operationStatus", render: (value: string) => <Tag color={statusMap[value]?.color}>{statusMap[value]?.label ?? value}</Tag> },
            { title: "服务能力", dataIndex: "serviceTypes", render: (value: string[]) => value?.join(" / ") || "-" },
            { title: "操作", fixed: "right", render: (_, record) => <Button type="link" onClick={() => openEditor(record)}>编辑</Button> }
          ]} />
        </QueryState>
      </Card>

      <Drawer title={editing ? "编辑资产" : "新增资产"} width={600} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
        <Alert type="warning" showIcon message="当前仍写入 Vehicle 兼容模型" description="资产编号、VIN、里程和 TBox CID 是车辆字段；未来非车辆品类应由资产属性 schema 和使用量指标驱动。" style={{ marginBottom: 20 }} />
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate({ ...editing, ...values })}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="licensePlate" label="资产编号（兼容车牌）" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="vin" label="序列号（兼容 VIN）" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="vehicleGroupName" label="标的分组" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(groups.data ?? []).map((item) => ({ value: item.storeProductGroupName, label: item.storeProductGroupName }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="assetCompanyName" label="资产归属" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="currentStoreName" label="当前门店" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={Array.from(new Set((locations.data?.rows ?? []).map((item) => item.parentStoreName))).map((value) => ({ value, label: value }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="currentStationName" label="当前履约点" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(locations.data?.rows ?? []).map((item) => ({ value: item.name, label: `${item.name} · ${item.parentStoreName}` }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="operationStatus" label="运营状态" rules={[{ required: true }]}><Select options={Object.entries(statusMap).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="mileage" label="使用量（兼容里程）" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="color" label="颜色 / 外观" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="cid" label="TBox CID"><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="serviceTypes" label="服务能力" rules={[{ required: true }]}><Select mode="multiple" options={[{ value: "STORE_STANDARD", label: "标准门店" }, { value: "STORE_24H", label: "24 小时自助" }]} /></Form.Item>
          <Form.Item name="currentServiceType" label="当前服务类型" rules={[{ required: true }]}><Select options={[{ value: "STORE_STANDARD", label: "标准门店" }, { value: "STORE_24H", label: "24 小时自助" }]} /></Form.Item>
          <Space size="large"><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item><Form.Item name="isSpecial" label="特殊资产" valuePropName="checked"><Switch /></Form.Item></Space>
        </Form>
      </Drawer>
    </>
  );
}

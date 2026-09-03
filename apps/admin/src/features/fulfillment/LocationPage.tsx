import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { RentalFulfillmentLocation, RentalFulfillmentOperator, SaveRentalFulfillmentLocationRequest, SaveRentalFulfillmentOperatorRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Col, Drawer, Form, Input, Row, Select, Space, Table, Tag } from "antd";
import { useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { resolveTenantNavigationLabels } from "@/app/navigation-terminology";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const locationTypeLabels: Record<string, string> = { store: "门店", warehouse: "仓库", station: "取还点", locker: "自提柜", delivery_hub: "配送中心", project_site: "项目现场" };
const capabilityLabels: Record<string, string> = { pickup: "领取", return: "归还", storage: "仓储", delivery: "配送" };

export function LocationPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((state) => state.hasPermission("store-rental:station:manage"));
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<RentalFulfillmentLocation>();
  const [editingOperator, setEditingOperator] = useState<RentalFulfillmentOperator>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [operatorDrawerOpen, setOperatorDrawerOpen] = useState(false);
  const [form] = Form.useForm<SaveRentalFulfillmentLocationRequest>();
  const [operatorForm] = Form.useForm<SaveRentalFulfillmentOperatorRequest>();
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  const operators = useQuery({ queryKey: ["rental-core", "operators"], queryFn: rentalCoreApi.operators });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const categories = useQuery({ queryKey: ["rental-core", "categories"], queryFn: rentalCoreApi.categories });
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const save = useMutation({ mutationFn: rentalCoreApi.saveLocation, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "locations"] }); setDrawerOpen(false); setEditing(undefined); form.resetFields(); message.success("履约地点已保存"); }, onError: () => message.error("保存失败，请检查地点类型、编码、经营主体和履约能力") });
  const saveOperator = useMutation({ mutationFn: rentalCoreApi.saveOperator, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "operators"] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "locations"] })]); setOperatorDrawerOpen(false); setEditingOperator(undefined); operatorForm.resetFields(); message.success("经营主体已保存"); }, onError: () => message.error("经营主体保存失败") });
  const rows = useMemo(() => (locations.data ?? []).filter((item) => !keyword || `${item.code}${item.name}${item.operatorName}${item.address}`.toLowerCase().includes(keyword.toLowerCase())), [keyword, locations.data]);

  function openEditor(record?: RentalFulfillmentLocation) {
    setEditing(record);
    form.setFieldsValue(record ? { ...record } : {
      code: "", name: "", type: category?.businessModel.locationTypes[0] ?? "store", operatorId: operators.data?.find((item) => item.status === "enabled")?.id,
      capabilities: ["pickup", "return", "storage"], address: "", contactName: "", contactPhone: "", businessHours: "09:00-18:00", status: "enabled"
    });
    setDrawerOpen(true);
  }

  function openOperatorEditor(record?: RentalFulfillmentOperator) {
    setEditingOperator(record);
    operatorForm.setFieldsValue(record ? { ...record } : { code: "", name: "", type: "partner", settlementMode: "monthly", status: "enabled" });
    setOperatorDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title={resolveTenantNavigationLabels(profile.data?.terminology).routes.locations ?? "履约地点"} description="经营主体与地点分层管理，地点类型与履约能力由经营品类约束。" note={{ title: `${category?.name ?? "当前品类"}履约网络`, description: "车行、摄影合作商等是经营主体；门店、仓库、自提柜和项目现场是主体下的履约地点。订单保存地点与经营主体快照，避免后续档案变更影响历史单据。" }} extra={canManage ? <Space><Button onClick={() => openOperatorEditor()}>新增经营主体</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增履约地点</Button></Space> : undefined} />
      <Card title={`经营主体（${operators.data?.length ?? 0}）`} className="data-panel" style={{ marginBottom: 16 }} styles={{ body: { paddingBottom: 0 } }}>
        <QueryState loading={operators.isLoading} error={operators.error}>
          <Table<RentalFulfillmentOperator> rowKey="id" dataSource={operators.data ?? []} pagination={false} columns={[
            { title: "主体", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code}</span></> },
            { title: "经营方式", dataIndex: "type", render: (value) => <Tag color={value === "partner" ? "purple" : "blue"}>{value === "partner" ? "合作商" : "自营"}</Tag> },
            { title: "结算方式", dataIndex: "settlementMode", render: (value) => ({ self: "内部结算", monthly: "月结", per_order: "逐单结算" }[value as string] ?? "-") },
            { title: "联系人", render: (_, row) => row.contactName ? `${row.contactName} · ${row.contactPhone ?? "-"}` : "-" },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value === "enabled" ? "启用" : "停用"}</Tag> },
            { title: "操作", render: (_, row) => canManage ? <Button type="link" onClick={() => openOperatorEditor(row)}>编辑</Button> : "-" }
          ]} />
        </QueryState>
      </Card>
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space style={{ marginBottom: 16 }}><Input allowClear prefix={<SearchOutlined />} placeholder="搜索地点、经营主体或地址" value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 320 }} /></Space>
          <QueryState loading={locations.isLoading || profile.isLoading || categories.isLoading || operators.isLoading} error={locations.error || profile.error || categories.error || operators.error}>
          <Table<RentalFulfillmentLocation> rowKey="id" dataSource={rows} scroll={{ x: 960 }} columns={[
            { title: "履约地点", fixed: "left", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code}</span></> },
            { title: "经营主体", render: (_, row) => <>{row.operatorName ?? "未配置"}<br /><Tag color={row.operatorType === "partner" ? "purple" : "blue"}>{row.operatorType === "partner" ? "合作商" : "自营"}</Tag></> },
            { title: "地点类型", dataIndex: "type", render: (value) => <Tag>{locationTypeLabels[value] ?? value}</Tag> },
            { title: "履约能力", dataIndex: "capabilities", render: (values) => <Space wrap>{values.map((value: string) => <Tag color="cyan" key={value}>{capabilityLabels[value] ?? value}</Tag>)}</Space> },
            { title: "地址", dataIndex: "address", render: (value) => value || "-" },
            { title: "联系人", render: (_, row) => row.contactName ? `${row.contactName} · ${row.contactPhone ?? "-"}` : "-" },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value === "enabled" ? "启用" : "停用"}</Tag> },
            { title: "操作", fixed: "right", render: (_, row) => canManage ? <Button type="link" onClick={() => openEditor(row)}>编辑</Button> : "-" }
          ]} />
        </QueryState>
      </Card>

      <Drawer title={editing ? "编辑履约地点" : "新增履约地点"} size={640} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
        <Form<SaveRentalFulfillmentLocationRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, id: editing?.id })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="地点编码" rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="地点名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="type" label="地点类型" rules={[{ required: true }]}><Select options={category?.businessModel.locationTypes.map((value) => ({ value, label: locationTypeLabels[value] ?? value }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="parentLocationId" label="上级地点"><Select allowClear options={(locations.data ?? []).filter((item) => item.id !== editing?.id).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            <Col span={24}><Form.Item name="operatorId" label="经营主体" rules={[{ required: true }]}><Select options={(operators.data ?? []).filter((item) => item.status === "enabled" || item.id === editing?.operatorId).map((item) => ({ value: item.id, label: `${item.name} · ${item.type === "partner" ? "合作商" : "自营"}` }))} /></Form.Item></Col>
          </Row>
          <Form.Item name="capabilities" label="履约能力" rules={[{ required: true }]}><Select mode="multiple" options={Object.entries(capabilityLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="address" label="地址"><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="contactName" label="联系人"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="contactPhone" label="联系电话"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="businessHours" label="营业时间"><Input placeholder="09:00-18:00" /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item></Col>
          </Row>
        </Form>
      </Drawer>
      <Drawer title={editingOperator ? "编辑经营主体" : "新增经营主体"} size={560} open={operatorDrawerOpen} destroyOnHidden onClose={() => setOperatorDrawerOpen(false)} extra={<Button type="primary" loading={saveOperator.isPending} onClick={() => operatorForm.submit()}>保存</Button>}>
        <Form<SaveRentalFulfillmentOperatorRequest> form={operatorForm} layout="vertical" onFinish={(values) => saveOperator.mutate({ ...values, id: editingOperator?.id })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="主体编码" rules={[{ required: true }]}><Input disabled={Boolean(editingOperator)} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="主体名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="type" label="经营方式" rules={[{ required: true }]}><Select options={[{ value: "self_operated", label: "自营" }, { value: "partner", label: "合作商" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="settlementMode" label="结算方式" rules={[{ required: true }]}><Select options={[{ value: "self", label: "内部结算" }, { value: "monthly", label: "月结" }, { value: "per_order", label: "逐单结算" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="contactName" label="联系人"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="contactPhone" label="联系电话"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item></Col>
          </Row>
        </Form>
      </Drawer>
    </>
  );
}

import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { RentalFulfillmentLocation, SaveRentalFulfillmentLocationRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, Row, Select, Space, Table, Tag } from "antd";
import { useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm<SaveRentalFulfillmentLocationRequest>();
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const categories = useQuery({ queryKey: ["rental-core", "categories"], queryFn: rentalCoreApi.categories });
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const save = useMutation({ mutationFn: rentalCoreApi.saveLocation, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "locations"] }); setDrawerOpen(false); setEditing(undefined); form.resetFields(); message.success("履约地点已保存"); }, onError: () => message.error("保存失败，请检查地点类型、编码、经营主体和履约能力") });
  const rows = useMemo(() => (locations.data ?? []).filter((item) => !keyword || `${item.code}${item.name}${item.operatorName}${item.address}`.toLowerCase().includes(keyword.toLowerCase())), [keyword, locations.data]);

  function openEditor(record?: RentalFulfillmentLocation) {
    setEditing(record);
    form.setFieldsValue(record ? { ...record, operatorType: record.operatorType ?? "self_operated", operatorName: record.operatorName ?? "" } : {
      code: "", name: "", type: category?.businessModel.locationTypes[0] ?? "store", operatorType: "self_operated", operatorName: "",
      capabilities: ["pickup", "return", "storage"], address: "", contactName: "", contactPhone: "", businessHours: "09:00-18:00", status: "enabled"
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title={profile.data?.terminology.fulfillmentLabel ?? "履约地点"} description="自营和合作经营主体共用地点模型，地点类型与履约能力由经营品类约束。" extra={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增履约地点</Button> : undefined} />
      <Alert type="info" showIcon message={`${category?.name ?? "当前品类"}履约网络`} description="车行、摄影合作商等属于经营主体；门店、仓库、自提柜和项目现场属于其下的履约地点。当前先在地点中保存经营主体快照，后续拆为独立合作商档案。" style={{ marginBottom: 16 }} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space style={{ marginBottom: 16 }}><Input allowClear prefix={<SearchOutlined />} placeholder="搜索地点、经营主体或地址" value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 320 }} /></Space>
        <QueryState loading={locations.isLoading || profile.isLoading || categories.isLoading} error={locations.error || profile.error || categories.error}>
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

      <Drawer title={editing ? "编辑履约地点" : "新增履约地点"} width={640} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
        <Form<SaveRentalFulfillmentLocationRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, id: editing?.id })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="地点编码" rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="地点名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="type" label="地点类型" rules={[{ required: true }]}><Select options={category?.businessModel.locationTypes.map((value) => ({ value, label: locationTypeLabels[value] ?? value }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="parentLocationId" label="上级地点"><Select allowClear options={(locations.data ?? []).filter((item) => item.id !== editing?.id).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="operatorType" label="经营方式" rules={[{ required: true }]}><Select options={[{ value: "self_operated", label: "自营" }, { value: "partner", label: "合作商" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="operatorName" label="经营主体名称" rules={[{ required: true }]}><Input placeholder="车行、器材合作商或自营公司" /></Form.Item></Col>
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
    </>
  );
}

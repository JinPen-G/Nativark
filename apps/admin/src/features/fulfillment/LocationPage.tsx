import { PlusOutlined } from "@/components/ui/icons";
import type { RentalFulfillmentLocation, RentalFulfillmentOperator, SaveRentalFulfillmentLocationRequest, SaveRentalFulfillmentOperatorRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Space, Tag } from "antd";
import { ListSection, App } from "@/components/ui";
import { ActionButton, Alert, Button, DataTableText, Form, Input, Modal, SaveButton, SearchField, Select, Table, Tabs } from "@/components/ui";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { useMemo, useState } from "react";
import { api as platformApi } from "@/api/platform";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { resolveTenantNavigationLabels } from "@/app/navigation-terminology";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { locationCapabilities, operatorCapabilities } from "@/features/listCapabilities";
import { locationCards } from "./locationCards";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { ADMIN_TABLE_COLUMN_WIDTH } from "@/app/designTokens";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useModalDismissal } from "@/components/ui/useModalDismissal";

const locationTypeLabels: Record<string, string> = { store: "门店", warehouse: "仓库", station: "取还点", locker: "自提柜", delivery_hub: "配送中心", project_site: "项目现场" };
const capabilityLabels: Record<string, string> = { pickup: "领取", return: "归还", storage: "仓储", delivery: "配送" };

export function LocationPage() {
  const scope = useListQueryIdentity();
  return <LocationWorkspace key={scope} scope={scope} />;
}

function LocationWorkspace({ scope }: { scope: string }) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:station:manage"));
  const canManageOrganizationMapping = useAuthStore((state) =>
    state.user?.dataScope === "all" && state.user.locationScope?.mode !== "selected" && state.hasPermission("system:user:manage")
  );
  const canViewOrganizations = useAuthStore((state) => state.hasPermission("system:user:manage"));
  const [keyword, setKeyword] = useState("");
  const [view, setView] = useState("locations");
  const [editing, setEditing] = useState<RentalFulfillmentLocation>();
  const [editingOperator, setEditingOperator] = useState<RentalFulfillmentOperator>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [operatorDrawerOpen, setOperatorDrawerOpen] = useState(false);
  const [form] = Form.useForm<SaveRentalFulfillmentLocationRequest>();
  const [operatorForm] = Form.useForm<SaveRentalFulfillmentOperatorRequest>();
  const locationEditor = useModalDismissal(drawerOpen, () => { setDrawerOpen(false); setEditing(undefined); form.resetFields(); });
  const operatorEditor = useModalDismissal(operatorDrawerOpen, () => { setOperatorDrawerOpen(false); setEditingOperator(undefined); operatorForm.resetFields(); });
  const locations = useQuery({ queryKey: ["rental-core", "locations", scope], queryFn: rentalCoreApi.locations });
  const organizations = useQuery({ queryKey: ["tenant-access", "organizations", scope], queryFn: platformApi.organizations, enabled: canViewOrganizations });
  const operators = useQuery({ queryKey: ["rental-core", "operators", scope], queryFn: rentalCoreApi.operators });
  const profile = useQuery({ queryKey: ["rental-core", "profile", scope], queryFn: rentalCoreApi.profile });
  const categories = useQuery({ queryKey: ["rental-core", "categories", scope], queryFn: rentalCoreApi.categories });
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const organizationNames = useMemo(() => new Map((organizations.data ?? []).map((item) => [item.id, item.name])), [organizations.data]);
  const save = useMutation({ mutationFn: rentalCoreApi.saveLocation, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "locations"] }); locationEditor.dismiss(); message.success(t("履约地点已保存")); }, onError: () => message.error(t("保存失败，请检查地点类型、编码、经营主体和履约能力")) });
  const saveOperator = useMutation({ mutationFn: rentalCoreApi.saveOperator, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "operators"] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "locations"] })]); operatorEditor.dismiss(); message.success(t("经营主体已保存")); }, onError: () => message.error(t("经营主体保存失败")) });
  const rows = useMemo(() => (locations.data ?? []).filter((item) => !keyword || `${item.code}${item.name}${item.operatorName}${item.address}${organizationNames.get(item.organizationId ?? "") ?? ""}`.toLowerCase().includes(keyword.toLowerCase())), [keyword, locations.data, organizationNames]);
  const locationUnavailable = !canManage || !category || locations.isError || operators.isPending || operators.isError || profile.isError || categories.isError || (canManageOrganizationMapping && (organizations.isPending || organizations.isError));
  const operatorUnavailable = !canManage || operators.isPending || operators.isError;
  const cards = locationCards({ t, typeLabels: locationTypeLabels, capabilityLabels, canManage: !locationUnavailable && !save.isPending, edit: openEditor });

  function openEditor(record?: RentalFulfillmentLocation) {
    if (locationUnavailable || save.isPending) return;
    setEditing(record);
    form.resetFields();
    form.setFieldsValue(record ? { ...record } : {
      code: "", name: "", organizationId: undefined, type: category?.businessModel.locationTypes[0] ?? "store", operatorId: operators.data?.find((item) => item.status === "enabled")?.id,
      capabilities: ["pickup", "return", "storage"], address: "", province: "", city: "", district: "", timezone: "Asia/Shanghai", latitude: undefined, longitude: undefined, contactName: "", contactPhone: "", businessHours: "09:00-18:00", status: "enabled"
    });
    setDrawerOpen(true);
  }

  function openOperatorEditor(record?: RentalFulfillmentOperator) {
    if (operatorUnavailable || saveOperator.isPending) return;
    setEditingOperator(record);
    operatorForm.resetFields();
    operatorForm.setFieldsValue(record ? { ...record } : { code: "", name: "", type: "partner", settlementMode: "monthly", status: "enabled" });
    setOperatorDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title={t(resolveTenantNavigationLabels(profile.data?.terminology).routes.locations ?? "履约地点")} note={{ title: `${t(category?.name ?? "当前品类")}${t("履约网络")}`, description: t("自营机构与合作商是经营主体；门店、仓库、自提柜、取还点和项目现场是主体下的履约地点。订单保存地点与经营主体快照，避免后续档案变更影响历史单据。") }} extra={canManage ? <Button type="primary" disabled={view === "operators" ? operatorUnavailable || saveOperator.isPending : locationUnavailable || save.isPending} icon={<PlusOutlined />} onClick={() => view === "operators" ? openOperatorEditor() : openEditor()}>{t(view === "operators" ? "新增经营主体" : "新增履约地点")}</Button> : undefined} />
      <Tabs aria-label={t("履约网络")} activeKey={view} onChange={setView} items={[{ key: "locations", label: t("履约地点") }, { key: "operators", label: t("经营主体") }]} />
      <ContentTransition value={view}>
      <div hidden={view !== "operators"}>
      <ListSection title={t("经营主体")} style={{ marginBottom: "var(--rental-layout-section-gap)" }}>
        <QueryState loading={operators.isLoading} error={operators.error} onRetry={() => operators.refetch({ throwOnError: true })}>
          <Table<RentalFulfillmentOperator> rowKey="id" onRefresh={() => operators.refetch()} loading={operators.isLoading} refreshing={operators.isFetching} dataSource={operators.data ?? []} pagination={false}
            {...operatorCapabilities(t, () => Promise.all([operators.refetch({ throwOnError: true }), locations.refetch({ throwOnError: true })]))} columns={[
            { title: t("主体"), dataIndex: "name", minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity, render: (_, row) => <DataTableText primary={row.name} secondary={row.code} /> },
            { title: t("经营方式"), dataIndex: "type", render: (value) => <Tag color={value === "partner" ? "purple" : "blue"}>{t(value === "partner" ? "合作商" : "自营")}</Tag> },
            { title: t("结算方式"), dataIndex: "settlementMode", render: (value) => t(({ self: "内部结算", monthly: "月结", per_order: "逐单结算" }[value as string] ?? "-")) },
            { title: t("联系人"), render: (_, row) => <DataTableText primary={row.contactName || row.contactPhone || "—"} secondary={row.contactName ? row.contactPhone : undefined} /> },
            { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{t(value === "enabled" ? "启用" : "停用")}</Tag> },
            { title: t("操作"), render: (_, row) => canManage ? <Button type="link" disabled={operatorUnavailable || saveOperator.isPending} onClick={() => openOperatorEditor(row)}>{t("编辑")}</Button> : "-" }
          ]} />
        </QueryState>
      </ListSection>
      </div>
      <div hidden={view !== "locations"}>
      {(operators.isError || (canViewOrganizations && organizations.isError)) && <div style={{ marginBottom: "var(--rental-layout-section-gap)" }}><Alert type="warning" showIcon title={t("地点关联资料读取失败")} description={t("地点列表仍可查看，重新载入关联资料后再编辑。")} action={<ActionButton label={t("重试")} onAction={() => Promise.all([operators.refetch({ throwOnError: true }), ...(canViewOrganizations ? [organizations.refetch({ throwOnError: true })] : [])])} />} /></div>}
      <ListSection controls={<><SearchField label={t("搜索履约地点")} placeholder={t("搜索地点、经营主体或地址")} value={keyword} onValueChange={setKeyword} style={{ width: "var(--rental-control-width-search)" }} /></>}>

          <QueryState loading={locations.isLoading || profile.isLoading || categories.isLoading} error={locations.error || profile.error || categories.error} onRetry={() => Promise.all([locations.refetch({ throwOnError: true }), profile.refetch({ throwOnError: true }), categories.refetch({ throwOnError: true })])}>
          <Table<RentalFulfillmentLocation> emptyScene={keyword.trim() ? "search" : "empty"} cardView={cards} rowKey="id" onRefresh={() => locations.refetch()} loading={locations.isLoading} refreshing={locations.isFetching} dataSource={rows} scroll={{ x: 960 }}
            {...locationCapabilities(t, category?.businessModel.locationTypes ?? [], () => locations.refetch({ throwOnError: true }))} columns={[
            { title: t("履约地点"), dataIndex: "name", minWidth: ADMIN_TABLE_COLUMN_WIDTH.location, fixed: "left", render: (_, row) => <DataTableText primary={row.name} secondary={row.code} /> },
            { title: t("归属组织"), render: (_, row) => row.organizationId ? organizationNames.get(row.organizationId) ?? t("已关联组织") : t("未分配") },
            { title: t("经营主体"), dataIndex: "operatorName", render: (_, row) => <DataTableText primary={row.operatorName ?? t("未配置")} secondary={row.operatorType ? t(row.operatorType === "partner" ? "合作商" : "自营") : undefined} /> },
            { title: t("地点类型"), dataIndex: "type", render: (value) => <Tag>{t(locationTypeLabels[value] ?? value)}</Tag> },
            { title: t("履约能力"), dataIndex: "capabilities", render: (values: string[]) => values.length ? <Space wrap size={[8, 4]}>{values.map(value => <span key={value} style={{ whiteSpace: "nowrap" }}>{t(capabilityLabels[value] ?? value)}</span>)}</Space> : "—" },
            { title: t("地址"), dataIndex: "address", render: (value) => value || "-" },
            { title: t("联系人"), render: (_, row) => <DataTableText primary={row.contactName || row.contactPhone || "—"} secondary={row.contactName ? row.contactPhone : undefined} /> },
            { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{t(value === "enabled" ? "启用" : "停用")}</Tag> },
            { title: t("操作"), fixed: "right", render: (_, row) => canManage ? <Button type="link" disabled={locationUnavailable || save.isPending} onClick={() => openEditor(row)}>{t("编辑")}</Button> : "-" }
          ]} />
        </QueryState>
      </ListSection>
      </div>
      </ContentTransition>

      <Modal presentation="side" title={editing ? t("编辑履约地点") : t("新增履约地点")} width={640} open={locationEditor.visible} destroyOnHidden onCancel={locationEditor.dismiss} afterClose={locationEditor.afterClose}
        closable={!save.isPending} keyboard={!save.isPending} maskClosable={!save.isPending}
        footer={<><Button disabled={save.isPending} onClick={locationEditor.dismiss}>{t("取消")}</Button><SaveButton disabled={locationUnavailable} label={t("保存")} form={form} pending={save.isPending} onSave={(values) => {
        if (locationUnavailable || save.isPending) return Promise.reject(new Error("Operation unavailable"));
        const payload: SaveRentalFulfillmentLocationRequest = { ...values, id: editing?.id };
        if (canManageOrganizationMapping) payload.organizationId = values.organizationId || null;
        else delete payload.organizationId;
        return save.mutateAsync(payload);
      }} /></>}>
        <Form<SaveRentalFulfillmentLocationRequest> name="fulfillment-location" form={form} layout="vertical" disabled={locationUnavailable || save.isPending} onFinish={(values) => {
          if (locationUnavailable || save.isPending) return;
          const payload: SaveRentalFulfillmentLocationRequest = { ...values, id: editing?.id };
          if (canManageOrganizationMapping) payload.organizationId = values.organizationId || null;
          else delete payload.organizationId;
          save.mutate(payload);
        }}>
          <SettingsWorkspace sections={[
          { key: "profile", label: t("基本资料"), content: <div>
          <Row gutter={16}>
            <Col span={24}><Form.Item name="name" label={t("地点名称")} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="code" label={t("地点编码")} rules={[{ required: true }]}><Input disabled={Boolean(editing) || locationUnavailable || save.isPending} /></Form.Item></Col>
            <Col span={12}><Form.Item name="type" label={t("地点类型")} rules={[{ required: true }]}><Select options={category?.businessModel.locationTypes.map((value) => ({ value, label: t(locationTypeLabels[value] ?? value) }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="parentLocationId" label={t("上级地点")}><Select allowClear options={(locations.data ?? []).filter((item) => item.id !== editing?.id).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            {canManageOrganizationMapping ? <Col span={24}><Form.Item name="organizationId" label={t("归属组织")} tooltip={t("组织范围账号只能访问当前组织及下级组织明确关联的履约地点；未关联地点不会自动归属。") }><Select allowClear loading={organizations.isLoading} options={(organizations.data ?? []).filter((item) => item.status === "enabled" || item.id === editing?.organizationId).map((item) => ({ value: item.id, label: `${item.name} · ${item.code}${item.status === "enabled" ? "" : ` · ${t("已停用")}`}`, disabled: item.status !== "enabled" }))} /></Form.Item></Col> : null}
            <Col span={24}><Form.Item name="operatorId" label={t("经营主体")} rules={[{ required: true }]}><Select options={(operators.data ?? []).filter((item) => item.status === "enabled" || item.id === editing?.operatorId).map((item) => ({ value: item.id, label: `${item.name} · ${t(item.type === "partner" ? "合作商" : "自营")}` }))} /></Form.Item></Col>
          </Row>
          <Form.Item name="capabilities" label={t("履约能力")} rules={[{ required: true }]}><Select mode="multiple" aria-label={t("履约能力")} showSearch={false} options={Object.entries(capabilityLabels).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item>
          <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}><Select options={[{ value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item>
          </div> },
          { key: "address", label: t("地理位置"), content: <div>
          <Form.Item name="address" label={t("地址")}><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="province" label={t("省/直辖市")}><Input placeholder={t("如 上海市")} /></Form.Item></Col>
            <Col span={8}><Form.Item name="city" label={t("城市")}><Input placeholder={t("如 上海市")} /></Form.Item></Col>
            <Col span={8}><Form.Item name="district" label={t("区/县")}><Input placeholder={t("如 徐汇区")} /></Form.Item></Col>
            <Col span={12}><Form.Item name="timezone" label={t("时区")} tooltip={t("选填；默认 Asia/Shanghai")}><Input placeholder="Asia/Shanghai" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="latitude" label={t("纬度")} tooltip={t("选填；填写后小程序可按客户位置排序门店并提供地图导航，经纬度需成对填写")} rules={[{ type: "number", min: -90, max: 90, message: t("纬度范围 -90~90") }]}><InputNumber style={{ width: "100%" }} step={0.000001} placeholder={t("如 31.2231")} /></Form.Item></Col>
            <Col span={12}><Form.Item name="longitude" label={t("经度")} rules={[{ type: "number", min: -180, max: 180, message: t("经度范围 -180~180") }]}><InputNumber style={{ width: "100%" }} step={0.000001} placeholder={t("如 121.4737")} /></Form.Item></Col>
          </Row>
          </div> },
          { key: "contact", label: t("联系与营业"), content: <div>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="contactName" label={t("联系人")}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="contactPhone" label={t("联系电话")}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="businessHours" label={t("营业时间")}><Input placeholder="09:00-18:00" /></Form.Item></Col>
          </Row>
          </div> }
          ]} />
        </Form>
      </Modal>
      <Modal presentation="side" title={editingOperator ? t("编辑经营主体") : t("新增经营主体")} width={560} open={operatorEditor.visible} destroyOnHidden onCancel={operatorEditor.dismiss} afterClose={operatorEditor.afterClose}
        closable={!saveOperator.isPending} keyboard={!saveOperator.isPending} maskClosable={!saveOperator.isPending}
        footer={<><Button disabled={saveOperator.isPending} onClick={operatorEditor.dismiss}>{t("取消")}</Button><SaveButton disabled={operatorUnavailable} label={t("保存")} form={operatorForm} pending={saveOperator.isPending} onSave={(values) => operatorUnavailable || saveOperator.isPending ? Promise.reject(new Error("Operation unavailable")) : saveOperator.mutateAsync({ ...values, id: editingOperator?.id })} /></>}>
        <Form<SaveRentalFulfillmentOperatorRequest> name="fulfillment-operator" form={operatorForm} layout="vertical" disabled={operatorUnavailable || saveOperator.isPending} onFinish={(values) => { if (!operatorUnavailable && !saveOperator.isPending) saveOperator.mutate({ ...values, id: editingOperator?.id }); }}>
          <div>
          <Row gutter={16}>
            <Col span={24}><Form.Item name="name" label={t("主体名称")} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="code" label={t("主体编码")} rules={[{ required: true }]}><Input disabled={Boolean(editingOperator) || operatorUnavailable || saveOperator.isPending} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="status" label={t("状态")} rules={[{ required: true }]}><Select options={[{ value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="type" label={t("经营方式")} rules={[{ required: true }]}><Select options={[{ value: "self_operated", label: t("自营") }, { value: "partner", label: t("合作商") }]} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="settlementMode" label={t("结算方式")} rules={[{ required: true }]}><Select options={[{ value: "self", label: t("内部结算") }, { value: "monthly", label: t("月结") }, { value: "per_order", label: t("逐单结算") }]} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="contactName" label={t("联系人")}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="contactPhone" label={t("联系电话")}><Input /></Form.Item></Col>
          </Row>
          </div>
        </Form>
      </Modal>
    </>
  );
}

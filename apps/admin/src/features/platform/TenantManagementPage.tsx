import { ApartmentOutlined, EditOutlined, PauseCircleOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import type { BusinessWorkspace, CreateBusinessWorkspaceRequest, RentalCategoryCode, TenantBootstrapRequest, TenantSummary, UpdateBusinessWorkspaceRequest, UpdateTenantStatusRequest } from "@rental-os/shared";
import { RENTAL_CURRENCY_CODES, RENTAL_CURRENCY_META, TenantStatus } from "@rental-os/shared";
import { App, Button, Card, Descriptions, Drawer, Form, Input, Modal, Segmented, Select, Space, Table, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  bootstrapTenant,
  createTenantWorkspace,
  getTenantBootstrapPreview,
  listTenantWorkspaces,
  listTenants,
  updateTenant,
  updateTenantWorkspace,
  updateTenantStatus
} from "@/api/operations";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

type Editor = { type: "create" } | { type: "edit"; tenant: TenantSummary } | { type: "status"; tenant: TenantSummary } | undefined;
type WorkspaceEditor = { type: "create" } | { type: "edit"; workspace: BusinessWorkspace } | undefined;

const statusMeta = {
  [TenantStatus.Active]: { label: "正常", color: "success" },
  [TenantStatus.Frozen]: { label: "冻结", color: "warning" },
  [TenantStatus.Disabled]: { label: "停用", color: "default" }
} as const;

export function TenantManagementPage() {
  const { message } = App.useApp();
  const operator = useAuthStore((state) => state.user?.displayName ?? "SaaS 平台管理员");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [editor, setEditor] = useState<Editor>();
  const [workspaceTenant, setWorkspaceTenant] = useState<TenantSummary>();
  const [workspaceEditor, setWorkspaceEditor] = useState<WorkspaceEditor>();
  const [form] = Form.useForm<Record<string, unknown>>();
  const [workspaceForm] = Form.useForm<CreateBusinessWorkspaceRequest & UpdateBusinessWorkspaceRequest>();

  const tenants = useQuery({ queryKey: ["saas-tenants"], queryFn: listTenants });
  const categories = useQuery({ queryKey: ["rental-categories"], queryFn: rentalCoreApi.categories });
  const preview = useQuery({ queryKey: ["tenant-bootstrap-preview"], queryFn: getTenantBootstrapPreview });
  const workspaces = useQuery({
    queryKey: ["saas-tenant-workspaces", workspaceTenant?.tenantId],
    queryFn: () => listTenantWorkspaces(workspaceTenant!.tenantId),
    enabled: Boolean(workspaceTenant)
  });

  const rows = useMemo(() => (tenants.data ?? []).filter((tenant) =>
    tenant.tenantCode !== "platform" && (filter === "all" || tenant.tenantStatus === filter)
  ), [filter, tenants.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["saas-tenants"] });
  const refreshWorkspaces = async () => {
    await Promise.all([
      refresh(),
      queryClient.invalidateQueries({ queryKey: ["saas-tenant-workspaces", workspaceTenant?.tenantId] })
    ]);
  };
  const createTenant = useMutation({
    // 空字符串的可选字段按未填写处理：服务端 @IsNotEmpty 会拒绝 ""，而
    // 「不预建首个门店」的空白租户正是本页必须支持的合法开业路径。
    mutationFn: (values: TenantBootstrapRequest) => bootstrapTenant({
      ...values,
      storeName: values.storeName?.trim() || undefined,
      storeCode: values.storeCode?.trim() || undefined,
      operator
    }),
    onSuccess: async (result) => {
      await refresh();
      closeEditor();
      Modal.success({
        title: "SaaS 租户已初始化",
        width: 560,
        content: (
          <Descriptions column={1} size="small" bordered items={[
            { key: "tenant", label: "租户", children: `${result.tenant.tenantName}（${result.tenant.tenantCode}）` },
            { key: "category", label: "默认经营空间品类", children: result.tenant.categoryCode },
            { key: "account", label: "管理员账号", children: result.adminUser.account },
            { key: "password", label: "一次性临时密码", children: <Typography.Text code copyable>{result.temporaryPassword}</Typography.Text> }
          ]} />
        )
      });
    },
    onError: () => message.error("租户初始化失败，数据库事务已回滚")
  });
  const saveTenant = useMutation({
    mutationFn: ({ id, tenantName }: { id: string; tenantName: string }) => updateTenant(id, { tenantName }),
    onSuccess: async () => { await refresh(); closeEditor(); message.success("租户资料已更新"); },
    onError: () => message.error("租户资料更新失败")
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTenantStatusRequest }) => updateTenantStatus(id, payload),
    onSuccess: async () => { await refresh(); closeEditor(); message.success("租户状态已更新，相关会话已按规则处理"); },
    onError: () => message.error("租户状态更新失败")
  });
  const createWorkspace = useMutation({
    mutationFn: (values: CreateBusinessWorkspaceRequest) => createTenantWorkspace(workspaceTenant!.tenantId, values),
    onSuccess: async () => { await refreshWorkspaces(); closeWorkspaceEditor(); message.success("经营空间已创建，租户管理员已自动加入"); },
    onError: () => message.error("经营空间创建失败，请检查编码和品类")
  });
  const saveWorkspace = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UpdateBusinessWorkspaceRequest }) => updateTenantWorkspace(workspaceTenant!.tenantId, id, values),
    onSuccess: async () => { await refreshWorkspaces(); closeWorkspaceEditor(); message.success("经营空间已更新"); },
    onError: () => message.error("经营空间更新失败")
  });

  function closeEditor() {
    setEditor(undefined);
    form.resetFields();
  }

  function openCreate() {
    form.setFieldsValue({ tenantCode: "", tenantName: "", categoryCode: undefined, currency: "CNY", adminAccount: "admin", adminDisplayName: "租户管理员", storeName: "", storeCode: "" });
    setEditor({ type: "create" });
  }

  function openEdit(tenant: TenantSummary) {
    form.setFieldsValue({ tenantName: tenant.tenantName });
    setEditor({ type: "edit", tenant });
  }

  function openStatus(tenant: TenantSummary) {
    form.setFieldsValue({ status: tenant.tenantStatus, reason: "" });
    setEditor({ type: "status", tenant });
  }

  function openWorkspaceManager(tenant: TenantSummary) {
    setWorkspaceTenant(tenant);
  }

  function closeWorkspaceEditor() {
    setWorkspaceEditor(undefined);
    workspaceForm.resetFields();
  }

  function openWorkspaceCreate() {
    workspaceForm.setFieldsValue({ code: "", name: "", categoryCode: undefined, status: "active" });
    setWorkspaceEditor({ type: "create" });
  }

  function openWorkspaceEdit(workspace: BusinessWorkspace) {
    workspaceForm.setFieldsValue({ name: workspace.name, status: workspace.status });
    setWorkspaceEditor({ type: "edit", workspace });
  }

  async function submit(values: Record<string, unknown>) {
    if (editor?.type === "create") createTenant.mutate(values as unknown as TenantBootstrapRequest);
    if (editor?.type === "edit") saveTenant.mutate({ id: editor.tenant.tenantId, tenantName: String(values.tenantName ?? "") });
    if (editor?.type === "status") changeStatus.mutate({ id: editor.tenant.tenantId, payload: values as unknown as UpdateTenantStatusRequest });
  }

  function submitWorkspace(values: CreateBusinessWorkspaceRequest & UpdateBusinessWorkspaceRequest) {
    if (workspaceEditor?.type === "create") {
      createWorkspace.mutate({ code: values.code, name: values.name ?? "", categoryCode: values.categoryCode });
    }
    if (workspaceEditor?.type === "edit") {
      saveWorkspace.mutate({ id: workspaceEditor.workspace.id, values: { name: values.name, status: values.status } });
    }
  }

  const categoryNames = useMemo(() => new Map((categories.data ?? []).map((category) => [category.code, category.name])), [categories.data]);

  return (
    <>
      <PageHeader
        title="SaaS 租户"
        description="管理使用 Rental OS 的租户主体、经营空间和生命周期；每个空间独立选择一个品类。"
        view={(
          <Segmented
            value={filter}
            onChange={(value) => setFilter(String(value))}
            options={[
              { label: "全部", value: "all" },
              { label: "正常", value: TenantStatus.Active },
              { label: "冻结", value: TenantStatus.Frozen },
              { label: "停用", value: TenantStatus.Disabled }
            ]}
          />
        )}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增 SaaS 租户</Button>}
      />
      <QueryState loading={tenants.isLoading || categories.isLoading} error={tenants.error ?? categories.error}>
        <Card className="data-panel" title={<Space><SafetyCertificateOutlined />租户管理<Typography.Text type="secondary">{tenants.data?.filter((item) => item.tenantCode !== "platform").length ?? 0}</Typography.Text></Space>}>
          <div className="table-toolbar">
            <Typography.Text type="secondary">一个租户可有多个经营空间；已有空间的品类固定，新增品类请新建空间。租户不做物理删除。</Typography.Text>
          </div>
          <Table<TenantSummary>
            rowKey="tenantId"
            dataSource={rows}
            scroll={{ x: 1120 }}
            columns={[
              { title: "租户", fixed: "left", width: 230, render: (_, row) => <><b>{row.tenantName}</b><br /><span className="muted">{row.tenantCode}</span></> },
              { title: "经营空间", width: 220, render: (_, row) => <Space size={[4, 4]} wrap><b>{row.workspaceCount ?? 0} 个</b>{row.workspaceCategoryCodes?.map((code) => <Tag key={code}>{categoryNames.get(code) ?? code}</Tag>)}</Space> },
              { title: "状态", width: 100, dataIndex: "tenantStatus", render: (value: TenantStatus) => <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag> },
              { title: "组织", width: 90, dataIndex: "organizationCount" },
              { title: "账号", width: 90, dataIndex: "userCount" },
              { title: "订单", width: 90, dataIndex: "orderCount" },
              { title: "状态原因", dataIndex: "statusReason", render: (value) => value || "—" },
              { title: "创建时间", width: 170, dataIndex: "createdAt", render: (value) => value ? new Date(value).toLocaleString() : "—" },
              { title: "操作", fixed: "right", width: 250, render: (_, row) => <Space size={0}><Button type="link" icon={<ApartmentOutlined />} onClick={() => openWorkspaceManager(row)}>经营空间</Button><Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>资料</Button><Button type="link" icon={<PauseCircleOutlined />} onClick={() => openStatus(row)}>状态</Button></Space> }
            ]}
          />
        </Card>
      </QueryState>

      <Drawer
        title={editor?.type === "create" ? "初始化 SaaS 租户" : editor?.type === "edit" ? "编辑租户资料" : "变更租户状态"}
        size={560}
        open={Boolean(editor)}
        destroyOnHidden
        onClose={closeEditor}
        extra={<Button type="primary" loading={createTenant.isPending || saveTenant.isPending || changeStatus.isPending} onClick={() => form.submit()}>保存</Button>}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          {editor?.type === "create" && (
            <>
              <Form.Item name="tenantCode" label="租户编码" extra="创建后不可修改，用于登录和数据隔离。" rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_-]{1,31}$/, message: "以小写字母开头，仅支持小写字母、数字、_ 和 -" }]}><Input /></Form.Item>
              <Form.Item name="tenantName" label="租户名称" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="categoryCode" label="默认空间品类" extra="用于创建首个默认经营空间；该空间创建后品类固定。" rules={[{ required: true }]}><Select options={(categories.data ?? []).map((item) => ({ value: item.code, label: `${item.name} · ${item.description}` }))} /></Form.Item>
              <Form.Item name="currency" label="结算币种" extra="订单、报价与配置金额的币种，跟随租户；新建经营空间时以此为默认值。" rules={[{ required: true }]}><Select options={RENTAL_CURRENCY_CODES.map((code) => ({ value: code, label: `${code} · ${RENTAL_CURRENCY_META[code].label}` }))} /></Form.Item>
              <Form.Item name="adminAccount" label="租户管理员账号" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="adminDisplayName" label="租户管理员姓名" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="adminPhone" label="联系电话"><Input /></Form.Item>
              <Form.Item name="storeName" label="首个履约地点"><Input /></Form.Item>
              <Form.Item name="storeCode" label="门店编码"><Input /></Form.Item>
              <Typography.Paragraph type="secondary">初始化将原子创建租户档案、首个默认经营空间、根组织、租户管理员、默认角色、字典和编号规则。后续可继续新增其他品类空间。模板项：{preview.data?.templates?.length ?? 0} 类。</Typography.Paragraph>
            </>
          )}
          {editor?.type === "edit" && <Form.Item name="tenantName" label="租户名称" rules={[{ required: true }]}><Input /></Form.Item>}
          {editor?.type === "status" && (
            <>
              <Form.Item name="status" label="目标状态" rules={[{ required: true }]}><Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))} /></Form.Item>
              <Form.Item name="reason" label="变更原因" rules={[{ required: true, min: 3 }]}><Input.TextArea rows={4} /></Form.Item>
              <Typography.Paragraph type="secondary">冻结或停用会立即撤销该租户所有登录会话；恢复为正常后账号可重新登录。</Typography.Paragraph>
            </>
          )}
        </Form>
      </Drawer>

      <Drawer
        title={workspaceTenant ? `${workspaceTenant.tenantName} · 经营空间` : "经营空间"}
        size={820}
        open={Boolean(workspaceTenant)}
        destroyOnHidden
        onClose={() => setWorkspaceTenant(undefined)}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openWorkspaceCreate}>新增经营空间</Button>}
      >
        <Typography.Paragraph type="secondary">每个空间只有一个经营品类。空间已有经营事实后不能原地换品类；需要新建空间并单独配置商品、资产、定价与成员。</Typography.Paragraph>
        <QueryState loading={workspaces.isLoading} error={workspaces.error}>
          <Table<BusinessWorkspace>
            rowKey="id"
            pagination={false}
            dataSource={workspaces.data ?? []}
            columns={[
              { title: "空间", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code}</span></> },
              { title: "经营品类", width: 150, render: (_, row) => categoryNames.get(row.categoryCode) ?? row.categoryCode },
              { title: "属性", width: 100, render: (_, row) => row.isDefault ? <Tag color="blue">默认空间</Tag> : "普通空间" },
              { title: "状态", width: 100, render: (_, row) => <Tag color={row.status === "active" ? "success" : row.status === "frozen" ? "warning" : "default"}>{row.status === "active" ? "正常" : row.status === "frozen" ? "冻结" : "停用"}</Tag> },
              { title: "操作", width: 90, render: (_, row) => <Button type="link" onClick={() => openWorkspaceEdit(row)}>编辑</Button> }
            ]}
          />
        </QueryState>
      </Drawer>

      <Drawer
        title={workspaceEditor?.type === "create" ? "新增经营空间" : "编辑经营空间"}
        size={520}
        open={Boolean(workspaceEditor)}
        destroyOnHidden
        onClose={closeWorkspaceEditor}
        extra={<Button type="primary" loading={createWorkspace.isPending || saveWorkspace.isPending} onClick={() => workspaceForm.submit()}>保存</Button>}
      >
        <Form form={workspaceForm} layout="vertical" onFinish={submitWorkspace}>
          {workspaceEditor?.type === "create" && <Form.Item name="code" label="空间编码" extra="创建后不可修改；同一租户内唯一。" rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_-]{1,31}$/, message: "以小写字母开头，仅支持小写字母、数字、_ 和 -" }]}><Input /></Form.Item>}
          <Form.Item name="name" label="空间名称" rules={[{ required: true }]}><Input /></Form.Item>
          {workspaceEditor?.type === "create" && <Form.Item name="categoryCode" label="经营品类" extra="创建后固定，不能通过编辑资料直接切换。" rules={[{ required: true }]}><Select options={(categories.data ?? []).map((item) => ({ value: item.code, label: `${item.name} · ${item.description}` }))} /></Form.Item>}
          {workspaceEditor?.type === "edit" && <Form.Item label="经营品类"><Select value={workspaceEditor.workspace.categoryCode as RentalCategoryCode} disabled options={(categories.data ?? []).map((item) => ({ value: item.code, label: item.name }))} /></Form.Item>}
          {workspaceEditor?.type === "edit" && <Form.Item name="status" label="空间状态" rules={[{ required: true }]}><Select options={[{ value: "active", label: "正常" }, { value: "frozen", label: "冻结" }, { value: "disabled", label: "停用" }]} /></Form.Item>}
        </Form>
      </Drawer>
    </>
  );
}

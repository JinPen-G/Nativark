import { ListFilters, useListFilter } from "@/components/ui";
import { ListSection, SaveButton } from "@/components/ui";
import { ApartmentOutlined, EditOutlined, KeyOutlined, PauseCircleOutlined, PlusOutlined } from "@/components/ui/icons";
import type { BusinessWorkspace, CreateBusinessWorkspaceRequest, RentalCategoryCode, TenantBootstrapRequest, TenantSummary, UpdateBusinessWorkspaceRequest, UpdateTenantStatusRequest } from "@rental-os/shared";
import { RENTAL_CURRENCY_CODES, RENTAL_CURRENCY_META, TenantStatus } from "@rental-os/shared";
import { Descriptions, Space, Tag, Typography } from "antd";
import { App } from "@/components/ui";
import { Form } from "@/components/ui";
import { Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button, Drawer, Segmented } from "@/components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api/platform";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
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
  const { message, modal } = App.useApp();
  const { t } = useLocale();
  const operator = useAuthStore((state) => state.user?.displayName ?? t("SaaS 平台管理员"));
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [editor, setEditor] = useState<Editor>();
  const [workspaceTenant, setWorkspaceTenant] = useState<TenantSummary>();
  const [workspaceEditor, setWorkspaceEditor] = useState<WorkspaceEditor>();
  const [form] = Form.useForm<Record<string, unknown>>();
  const [workspaceForm] = Form.useForm<CreateBusinessWorkspaceRequest & UpdateBusinessWorkspaceRequest>();

  const tenants = useQuery({ queryKey: ["saas-tenants"], queryFn: api.tenants });
  const categories = useQuery({ queryKey: ["rental-categories"], queryFn: rentalCoreApi.categories });
  const preview = useQuery({ queryKey: ["tenant-bootstrap-preview"], queryFn: api.tenantBootstrapPreview });
  const workspaces = useQuery({
    queryKey: ["saas-tenant-workspaces", workspaceTenant?.tenantId],
    queryFn: () => api.tenantWorkspaces(workspaceTenant!.tenantId),
    enabled: Boolean(workspaceTenant)
  });

  const rows = useMemo(() => (tenants.data ?? []).filter((tenant) =>
    tenant.tenantCode !== "platform" && (filter === "all" || tenant.tenantStatus === filter)
  ), [filter, tenants.data]);

  const tenantFilter = useListFilter(rows, { fields: row => [row.tenantName, row.tenantCode] });
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
    mutationFn: (values: TenantBootstrapRequest) => api.bootstrapTenant({
      ...values,
      storeName: values.storeName?.trim() || undefined,
      storeCode: values.storeCode?.trim() || undefined,
      operator
    }),
    onSuccess: async (result) => {
      await refresh();
      closeEditor();
      modal.success({
        title: t("SaaS 租户已初始化"),
        width: 560,
        content: (
          <Descriptions column={1} size="small" bordered items={[
            { key: "tenant", label: t("租户"), children: `${result.tenant.tenantName} (${result.tenant.tenantCode})` },
            { key: "category", label: t("默认经营空间品类"), children: result.tenant.categoryCode },
            { key: "account", label: t("管理员账号"), children: result.adminUser.account },
            { key: "password", label: t("一次性临时密码"), children: <Typography.Text code copyable>{result.temporaryPassword}</Typography.Text> }
          ]} />
        )
      });
    },
    onError: () => message.error(t("租户初始化失败，数据库事务已回滚"))
  });
  const saveTenant = useMutation({
    mutationFn: ({ id, tenantName }: { id: string; tenantName: string }) => api.updateTenant(id, { tenantName }),
    onSuccess: async () => { await refresh(); closeEditor(); message.success(t("租户资料已更新")); },
    onError: () => message.error(t("租户资料更新失败"))
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTenantStatusRequest }) => api.updateTenantStatus(id, payload),
    onSuccess: async () => { await refresh(); closeEditor(); message.success(t("租户状态已更新，相关会话已按规则处理")); },
    onError: () => message.error(t("租户状态更新失败"))
  });
  const resetTenantAdmin = useMutation({
    mutationFn: api.resetTenantAdminPassword,
    onSuccess: (result) => modal.success({
      title: t("租户管理员密码已重置"),
      content: <><Typography.Paragraph>{result.message}</Typography.Paragraph><Typography.Text code copyable>{result.temporaryPassword}</Typography.Text></>
    }),
    onError: () => message.error(t("租户管理员密码重置失败"))
  });
  const createWorkspace = useMutation({
    mutationFn: (values: CreateBusinessWorkspaceRequest) => api.createTenantWorkspace(workspaceTenant!.tenantId, values),
    onSuccess: async () => { await refreshWorkspaces(); closeWorkspaceEditor(); message.success(t("经营空间已创建，租户管理员已自动加入")); },
    onError: () => message.error(t("经营空间创建失败，请检查编码和品类"))
  });
  const saveWorkspace = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UpdateBusinessWorkspaceRequest }) => api.updateTenantWorkspace(workspaceTenant!.tenantId, id, values),
    onSuccess: async () => { await refreshWorkspaces(); closeWorkspaceEditor(); message.success(t("经营空间已更新")); },
    onError: () => message.error(t("经营空间更新失败"))
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

  function confirmResetAdmin(tenant: TenantSummary) {
    modal.confirm({
      title: `${t("重置租户管理员密码")} “${tenant.tenantName}”？`,
      content: t("系统会生成一次性临时密码，并使该管理员的既有登录会话失效。"),
      okText: t("确认重置"),
      onOk: () => resetTenantAdmin.mutateAsync(tenant.tenantId)
    });
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
    if (editor?.type === "create") return createTenant.mutateAsync(values as unknown as TenantBootstrapRequest);
    if (editor?.type === "edit") return saveTenant.mutateAsync({ id: editor.tenant.tenantId, tenantName: String(values.tenantName ?? "") });
    if (editor?.type === "status") return changeStatus.mutateAsync({ id: editor.tenant.tenantId, payload: values as unknown as UpdateTenantStatusRequest });
    throw new Error("Tenant editor unavailable");
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
        title={t("SaaS 租户")}

        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("新增 SaaS 租户")}</Button>}
      />
      <QueryState loading={tenants.isLoading || categories.isLoading} error={tenants.error ?? categories.error}>
        <ListSection controls={<><ListFilters filter={tenantFilter} placeholder="租户名称或编码" /><Segmented
            value={filter}
            onChange={(value) => { setFilter(String(value)); tenantFilter.pagination.onChange(1, tenantFilter.pagination.pageSize); }}
            options={[
              { label: t("全部"), value: "all" },
              { label: t("正常"), value: TenantStatus.Active },
              { label: t("冻结"), value: TenantStatus.Frozen },
              { label: t("停用"), value: TenantStatus.Disabled }
            ]}
          /></>}>
          <Table<TenantSummary>
            rowKey="tenantId"
            onRefresh={() => tenants.refetch()} loading={tenants.isFetching} dataSource={tenantFilter.rows} pagination={tenantFilter.pagination}
            scroll={{ x: 1120 }}
            columns={[
              { title: t("租户"), fixed: "left", width: 230, render: (_, row) => <><b>{row.tenantName}</b><br /><span className="muted">{row.tenantCode}</span></> },
              { title: t("经营空间"), width: 220, render: (_, row) => <Space size={[4, 4]} wrap><b>{row.workspaceCount ?? 0} {t("个")}</b>{row.workspaceCategoryCodes?.map((code) => <Tag key={code}>{t(categoryNames.get(code) ?? code)}</Tag>)}</Space> },
              { title: t("状态"), width: 100, dataIndex: "tenantStatus", render: (value: TenantStatus) => <Tag color={statusMeta[value].color}>{t(statusMeta[value].label)}</Tag> },
              { title: t("专属登录链接"), width: 280, render: (_, row) => {
                const url = new URL(`/login/${encodeURIComponent(row.tenantCode)}`, window.location.origin).href;
                return <Typography.Text copyable={{ text: url }}><a href={url} target="_blank" rel="noopener noreferrer" title={url} style={{ display: "inline-block", maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{url}</a></Typography.Text>;
              } },
              { title: t("组织"), width: 90, dataIndex: "organizationCount" },
              { title: t("账号"), width: 90, dataIndex: "userCount" },
              { title: t("订单"), width: 90, dataIndex: "orderCount" },
              { title: t("状态原因"), dataIndex: "statusReason", render: (value) => value || "—" },
              { title: t("创建时间"), width: 170, dataIndex: "createdAt", render: (value) => value ? new Date(value).toLocaleString() : "—" },
              { title: t("操作"), fixed: "right", width: 340, render: (_, row) => <Space size={0} wrap><Button type="link" icon={<ApartmentOutlined />} onClick={() => openWorkspaceManager(row)}>{t("经营空间")}</Button><Button type="link" icon={<KeyOutlined />} loading={resetTenantAdmin.isPending} onClick={() => confirmResetAdmin(row)}>{t("重置管理员密码")}</Button><Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>{t("资料")}</Button><Button type="link" icon={<PauseCircleOutlined />} onClick={() => openStatus(row)}>{t("状态")}</Button></Space> }
            ]}
          />
        </ListSection>
      </QueryState>

      <Drawer
        title={editor?.type === "create" ? t("初始化 SaaS 租户") : editor?.type === "edit" ? t("编辑租户资料") : t("变更租户状态")}
        size={560}
        open={Boolean(editor)}
        destroyOnHidden
        onClose={closeEditor}
        extra={<SaveButton label={t("保存")} form={form} pending={createTenant.isPending || saveTenant.isPending || changeStatus.isPending} onSave={submit} />}
      >
        <Form form={form} layout="vertical" onFinish={values => { void submit(values).catch(() => undefined); }}>
          {editor?.type === "create" && (
            <>
              <Form.Item name="tenantCode" label={t("租户编码")} extra={t("创建后不可修改，用于登录和数据隔离。")} rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_-]{1,31}$/, message: t("以小写字母开头，仅支持小写字母、数字、_ 和 -") }]}><Input /></Form.Item>
              <Form.Item name="tenantName" label={t("租户名称")} rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="categoryCode" label={t("默认空间品类")} extra={t("用于创建首个默认经营空间；该空间创建后品类固定。")} rules={[{ required: true }]}><Select options={(categories.data ?? []).map((item) => ({ value: item.code, label: `${t(item.name)} · ${t(item.description)}` }))} /></Form.Item>
              <Form.Item name="currency" label={t("结算币种")} extra={t("订单、报价与配置金额的币种，跟随租户；新建经营空间时以此为默认值。")} rules={[{ required: true }]}><Select options={RENTAL_CURRENCY_CODES.map((code) => ({ value: code, label: `${code} · ${t(RENTAL_CURRENCY_META[code].label)}` }))} /></Form.Item>
              <Form.Item name="adminAccount" label={t("租户管理员账号")} rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="adminDisplayName" label={t("租户管理员姓名")} rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="adminPhone" label={t("联系电话")}><Input /></Form.Item>
              <Form.Item name="storeName" label={t("首个履约地点")}><Input /></Form.Item>
              <Form.Item name="storeCode" label={t("门店编码")}><Input /></Form.Item>
              <Typography.Paragraph type="secondary">{t("初始化将原子创建租户档案、首个默认经营空间、根组织、租户管理员、默认角色、字典和编号规则。后续可继续新增其他品类空间。模板项：")} {preview.data?.templates?.length ?? 0} {t("类。")}</Typography.Paragraph>
            </>
          )}
          {editor?.type === "edit" && <Form.Item name="tenantName" label={t("租户名称")} rules={[{ required: true }]}><Input /></Form.Item>}
          {editor?.type === "status" && (
            <>
              <Form.Item name="status" label={t("目标状态")} rules={[{ required: true }]}><Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: t(meta.label) }))} /></Form.Item>
              <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, min: 3 }]}><Input.TextArea rows={4} /></Form.Item>
              <Typography.Paragraph type="secondary">{t("冻结或停用会立即撤销该租户所有登录会话；恢复为正常后账号可重新登录。")}</Typography.Paragraph>
            </>
          )}
        </Form>
      </Drawer>

      <Drawer
        title={workspaceTenant ? `${workspaceTenant.tenantName} · ${t("经营空间")}` : t("经营空间")}
        size={820}
        open={Boolean(workspaceTenant)}
        destroyOnHidden
        onClose={() => setWorkspaceTenant(undefined)}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openWorkspaceCreate}>{t("新增经营空间")}</Button>}
      >
        <Typography.Paragraph type="secondary">{t("每个空间只有一个经营品类。空间已有经营事实后不能原地换品类；需要新建空间并单独配置商品、资产、定价与成员。")}</Typography.Paragraph>
        <QueryState loading={workspaces.isLoading} error={workspaces.error}>
          <Table<BusinessWorkspace>
            rowKey="id"
            pagination={false}
            onRefresh={() => workspaces.refetch()} loading={workspaces.isFetching} dataSource={workspaces.data ?? []}
            columns={[
              { title: t("空间"), render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code}</span></> },
              { title: t("经营品类"), width: 150, render: (_, row) => t(categoryNames.get(row.categoryCode) ?? row.categoryCode) },
              { title: t("属性"), width: 100, render: (_, row) => row.isDefault ? <Tag color="processing">{t("默认空间")}</Tag> : t("普通空间") },
              { title: t("状态"), width: 100, render: (_, row) => <Tag color={row.status === "active" ? "success" : row.status === "frozen" ? "warning" : "default"}>{t(row.status === "active" ? "正常" : row.status === "frozen" ? "冻结" : "停用")}</Tag> },
              { title: t("操作"), width: 90, render: (_, row) => <Button type="link" onClick={() => openWorkspaceEdit(row)}>{t("编辑")}</Button> }
            ]}
          />
        </QueryState>
      </Drawer>

      <Drawer
        title={workspaceEditor?.type === "create" ? t("新增经营空间") : t("编辑经营空间")}
        size={520}
        open={Boolean(workspaceEditor)}
        destroyOnHidden
        onClose={closeWorkspaceEditor}
        extra={<Button type="primary" loading={createWorkspace.isPending || saveWorkspace.isPending} onClick={() => workspaceForm.submit()}>{t("保存")}</Button>}
      >
        <Form form={workspaceForm} layout="vertical" onFinish={submitWorkspace}>
          {workspaceEditor?.type === "create" && <Form.Item name="code" label={t("空间编码")} extra={t("创建后不可修改；同一租户内唯一。")} rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_-]{1,31}$/, message: t("以小写字母开头，仅支持小写字母、数字、_ 和 -") }]}><Input /></Form.Item>}
          <Form.Item name="name" label={t("空间名称")} rules={[{ required: true }]}><Input /></Form.Item>
          {workspaceEditor?.type === "create" && <Form.Item name="categoryCode" label={t("经营品类")} extra={t("创建后固定，不能通过编辑资料直接切换。")} rules={[{ required: true }]}><Select options={(categories.data ?? []).map((item) => ({ value: item.code, label: `${t(item.name)} · ${t(item.description)}` }))} /></Form.Item>}
          {workspaceEditor?.type === "edit" && <Form.Item label={t("经营品类")}><Select value={workspaceEditor.workspace.categoryCode as RentalCategoryCode} disabled options={(categories.data ?? []).map((item) => ({ value: item.code, label: t(item.name) }))} /></Form.Item>}
          {workspaceEditor?.type === "edit" && <Form.Item name="status" label={t("空间状态")} rules={[{ required: true }]}><Select options={[{ value: "active", label: t("正常") }, { value: "frozen", label: t("冻结") }, { value: "disabled", label: t("停用") }]} /></Form.Item>}
        </Form>
      </Drawer>
    </>
  );
}

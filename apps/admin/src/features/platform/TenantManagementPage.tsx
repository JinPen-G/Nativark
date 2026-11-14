/** SaaS lifecycle shell. Rental Core supplies category/version choices; this page does not evaluate or authorize them. */
import { ListFilters, useListFilter } from "@/components/ui";
import { Alert, CopyButton, DataTableRowActions, DataTableText, FormSection, ListSection, Modal, SaveButton } from "@/components/ui";
import { ADMIN_TABLE_COLUMN_WIDTH } from "@/app/designTokens";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { Building2, KeyRound, Pencil, ShieldCheck } from "lucide-react";
import { PlusOutlined } from "@/components/ui/icons";
import type { BusinessWorkspace, CreateBusinessWorkspaceRequest, TenantBootstrapRequest, TenantSummary, UpdateBusinessWorkspaceRequest, UpdateTenantRequest, UpdateTenantStatusRequest } from "@rental-os/shared";
import { normalizeOperatorShortName, RENTAL_CURRENCY_CODES, RENTAL_CURRENCY_META, TenantStatus } from "@rental-os/shared";
import { Col, Descriptions, Row, Space, Tag, Typography } from "antd";
import { App } from "@/components/ui";
import { Form } from "@/components/ui";
import { Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button, Drawer, ListFilterItem } from "@/components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { api } from "@/api/platform";
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
  const { t, locale } = useLocale();
  const operator = useAuthStore((state) => state.user?.displayName ?? t("SaaS 平台管理员"));
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [editor, setEditor] = useState<Editor>();
  const [workspaceTenant, setWorkspaceTenant] = useState<TenantSummary>();
  const [workspaceEditor, setWorkspaceEditor] = useState<WorkspaceEditor>();
  const [categorySearch, setCategorySearch] = useState("");
  const deferredCategorySearch = useDeferredValue(categorySearch);
  const [form] = Form.useForm<Record<string, unknown>>();
  const [workspaceForm] = Form.useForm<CreateBusinessWorkspaceRequest & UpdateBusinessWorkspaceRequest>();
  const editorDialog = useModalDismissal(Boolean(editor), () => { setEditor(undefined); form.resetFields(); });
  const workspaceDialog = useModalDismissal(Boolean(workspaceEditor), () => { setWorkspaceEditor(undefined); workspaceForm.resetFields(); });
  const selectedTenantCategory = Form.useWatch("categoryCode", form);
  const shortName = Form.useWatch("operatorShortName", form);
  const fullTenantName = Form.useWatch("tenantName", form);
  const selectedWorkspaceCategory = Form.useWatch("categoryCode", workspaceForm);
  const categoryTarget = editor?.type === "create" ? undefined : workspaceTenant?.tenantId;
  const categoryDirectory = useQuery({ queryKey: ["saas-category-opening-options", categoryTarget, deferredCategorySearch],
    queryFn: () => api.rentalCategoryOpeningOptions({ tenantId: categoryTarget, search: deferredCategorySearch || undefined }),
    enabled: editorDialog.visible && editor?.type === "create" || workspaceDialog.visible && workspaceEditor?.type === "create" });

  const tenants = useQuery({ queryKey: ["saas-tenants"], queryFn: api.tenants });
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
    onError: () => message.error(t("未能确认初始化结果，请刷新租户列表核对后再操作。"))
  });
  const saveTenant = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTenantRequest }) => api.updateTenant(id, payload),
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
    editorDialog.dismiss();
  }

  function openCreate() {
    setCategorySearch("");
    form.resetFields();
    createTenant.reset();
    form.setFieldsValue({ tenantCode: "", tenantName: "", operatorShortName: "", categoryCode: undefined, currency: "CNY", adminAccount: "admin", adminDisplayName: "租户管理员", storeName: "", storeCode: "" });
    setEditor({ type: "create" });
  }

  function openEdit(tenant: TenantSummary) {
    form.resetFields();
    form.setFieldsValue({ tenantName: tenant.tenantName, operatorShortName: tenant.operatorShortName ?? "" });
    setEditor({ type: "edit", tenant });
  }

  function openStatus(tenant: TenantSummary) {
    form.resetFields();
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
    workspaceDialog.dismiss();
  }

  function openWorkspaceCreate() {
    setCategorySearch("");
    workspaceForm.resetFields();
    workspaceForm.setFieldsValue({ code: "", name: "", categoryCode: undefined, status: "active" });
    setWorkspaceEditor({ type: "create" });
  }

  function openWorkspaceEdit(workspace: BusinessWorkspace) {
    workspaceForm.resetFields();
    workspaceForm.setFieldsValue({ name: workspace.name, status: workspace.status });
    setWorkspaceEditor({ type: "edit", workspace });
  }

  async function submit(values: Record<string, unknown>) {
    if (editor?.type === "create") return createTenant.mutateAsync(values as unknown as TenantBootstrapRequest);
    if (editor?.type === "edit") return saveTenant.mutateAsync({ id: editor.tenant.tenantId,
      payload: { tenantName: String(values.tenantName ?? ""), operatorShortName: normalizeOperatorShortName(values.operatorShortName) } });
    if (editor?.type === "status") return changeStatus.mutateAsync({ id: editor.tenant.tenantId, payload: values as unknown as UpdateTenantStatusRequest });
    throw new Error("Tenant editor unavailable");
  }

  function submitWorkspace(values: CreateBusinessWorkspaceRequest & UpdateBusinessWorkspaceRequest) {
    if (workspaceEditor?.type === "create") {
      return createWorkspace.mutateAsync({ code: values.code, name: values.name ?? "", categoryCode: values.categoryCode, categoryVersionId: values.categoryVersionId });
    }
    if (workspaceEditor?.type === "edit") {
      return saveWorkspace.mutateAsync({ id: workspaceEditor.workspace.id, values: { name: values.name, status: values.status } });
    }
    return Promise.reject(new Error("Workspace editor unavailable"));
  }

  const categoryNames = useMemo(() => new Map([...(tenants.data ?? []).filter(tenant => tenant.categoryName).map(tenant => [tenant.categoryCode, tenant.categoryName!] as const),
    ...(categoryDirectory.data?.options ?? []).map(option => [option.categoryCode, locale === "en-US" && option.nameEn ? option.nameEn : option.name] as const)]), [tenants.data, categoryDirectory.data, locale]);
  const categoryOptions = [...new Map((categoryDirectory.data?.options ?? []).map(option => [option.categoryCode,
    { value: option.categoryCode, label: locale === "en-US" && option.nameEn ? option.nameEn : option.name }])).values()];
  const versionsFor = (code: unknown) => (categoryDirectory.data?.options ?? []).filter(option => option.categoryCode === code && option.versionId);
  const versionOptions = (code: unknown) => versionsFor(code).map(option => ({ value: option.versionId!, label: `${option.versionLabel}${option.recommended ? ` · ${t("默认推荐版本")}` : ""}` }));
  const selectCategory = (code: unknown, workspace = false) => {
    const versions = versionsFor(code);
    const selected = versions.find(version => version.recommended) ?? (versions.length === 1 ? versions[0] : undefined);
    if (workspace) workspaceForm.setFieldValue("categoryVersionId", selected?.versionId); else form.setFieldValue("categoryVersionId", selected?.versionId);
  };
  const saving = createTenant.isPending || saveTenant.isPending || changeStatus.isPending;
  const workspaceSaving = createWorkspace.isPending || saveWorkspace.isPending;
  const shortNameField = <Form.Item name="operatorShortName" label={locale === "en-US" ? "Operator short name" : "营运商简称"}
    extra={<><span>{locale === "en-US" ? "Used in the admin sidebar. Leave blank to use the full company name." : "用于后台左上身份显示；留空使用公司全称。"}</span><br />
      <span>{locale === "en-US" ? "Preview: " : "预览："}<strong title={String(fullTenantName ?? "")}>{String(shortName ?? "").trim() || String(fullTenantName ?? "") || "—"}</strong></span></>}
    rules={[{ validator: async (_rule, value) => { normalizeOperatorShortName(value); } }]}><Input autoComplete="off" /></Form.Item>;

  return (
    <>
      <PageHeader
        title={t("SaaS 租户")}

        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("新增 SaaS 租户")}</Button>}
      />
      <QueryState loading={tenants.isLoading} error={tenants.error} onRetry={() => tenants.refetch({ throwOnError: true })}>
        <ListSection controls={<><ListFilters filter={tenantFilter} placeholder="租户名称或编码" hasFilters={filter !== "all"} onClear={() => { tenantFilter.clear(); setFilter("all"); }} /><ListFilterItem label={t("租户状态")} priority active={filter !== "all"}><Select aria-label={t("租户状态")}
            value={filter}
            onChange={(value) => { setFilter(String(value)); tenantFilter.pagination.onChange(1, tenantFilter.pagination.pageSize); }}
            options={[
              { label: t("全部状态"), value: "all" },
              { label: t("正常"), value: TenantStatus.Active },
              { label: t("冻结"), value: TenantStatus.Frozen },
              { label: t("停用"), value: TenantStatus.Disabled }
            ]}
          /></ListFilterItem></>}>
          <Table<TenantSummary>
            rowKey="tenantId"
            onRefresh={() => tenants.refetch()} loading={tenants.isLoading} refreshing={tenants.isFetching} dataSource={tenantFilter.rows} pagination={tenantFilter.pagination}
            scroll={{ x: 1120 }}
            columns={[
              { title: t("租户"), fixed: "left", minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity, render: (_, row) => <DataTableText primary={row.tenantName} secondary={row.tenantCode} /> },
              { title: t("经营空间"), minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity, render: (_, row) => <DataTableText primary={row.workspaceCount == null ? "—" : `${row.workspaceCount} ${t("个")}`} secondary={row.workspaceCategoryCodes?.map(code => t(categoryNames.get(code) ?? code)).join(" · ")} /> },
              { title: t("状态"), width: 100, dataIndex: "tenantStatus", render: (value: TenantStatus) => <Tag color={statusMeta[value].color}>{t(statusMeta[value].label)}</Tag> },
              { title: t("专属登录链接"), width: 280, render: (_, row) => {
                const url = new URL(`/login/${encodeURIComponent(row.tenantCode)}`, window.location.origin).href;
                return <Space size={4}><a href={url} target="_blank" rel="noopener noreferrer" title={url}>{t("登录页")}</a><CopyButton value={url} label={t("复制登录链接")} /></Space>;
              } },
              { title: t("组织"), width: 90, dataIndex: "organizationCount" },
              { title: t("账号"), width: 90, dataIndex: "userCount" },
              { title: t("订单"), width: 90, dataIndex: "orderCount" },
              { title: t("状态原因"), dataIndex: "statusReason", render: (value) => value || "—" },
              { title: t("创建时间"), width: 170, dataIndex: "createdAt", render: (value) => value ? new Date(value).toLocaleString() : "—" },
              { title: t("操作"), fixed: "right", render: (_, row) => <DataTableRowActions details={() => openEdit(row)} detailLabel={t("编辑资料")} menuLabel={`${row.tenantName} · ${t("更多操作")}`}
                primary={{ id: "workspaces", label: t("经营空间"), icon: Building2, onSelect: () => openWorkspaceManager(row) }} actions={[
                  { id: "edit", label: t("编辑资料"), icon: Pencil, onSelect: () => openEdit(row) },
                  { id: "status", label: t("变更租户状态"), icon: ShieldCheck, onSelect: () => openStatus(row) },
                  { id: "reset", label: t("重置管理员密码"), icon: KeyRound, disabled: resetTenantAdmin.isPending, onSelect: () => confirmResetAdmin(row) },
                ]} /> }
            ]}
          />
        </ListSection>
      </QueryState>

      <Modal presentation={editor?.type === "create" ? "side" : "dialog"}
        title={editor?.type === "create" ? t("初始化 SaaS 租户") : editor?.type === "edit" ? t("编辑租户资料") : t("变更租户状态")}
        width={editor?.type === "create" ? 720 : 520}
        open={editorDialog.visible}
        destroyOnHidden
        onCancel={closeEditor}
        afterClose={editorDialog.afterClose}
        closable={!saving} keyboard={!saving} maskClosable={!saving}
        footer={<><Button disabled={saving} onClick={closeEditor}>{t("取消")}</Button><SaveButton label={t(editor?.type === "create" ? "创建租户" : "保存")} form={form} pending={saving}
          disabled={editor?.type === "create" && (!categoryDirectory.data || Boolean(categoryDirectory.error))} onSave={submit} /></>}
      >
        {editor && editor.type !== "create" && <Typography.Paragraph type="secondary">{editor.tenant.tenantName} · {editor.tenant.tenantCode}</Typography.Paragraph>}
        <Form form={form} layout="vertical" disabled={saving} onFinish={values => { void submit(values).catch(() => undefined); }}>
          {editor?.type === "create" && (
            <SettingsWorkspace sections={[
              { key: "tenant", label: t("租户资料"), content: <FormSection title={t("租户资料")}>
              <Form.Item name="tenantName" label={t("租户名称")} rules={[{ required: true }]}><Input /></Form.Item>
              {shortNameField}
              <Form.Item name="tenantCode" label={t("租户编码")} extra={t("创建后不可修改，用于登录和数据隔离。")} rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_-]{1,31}$/, message: t("以小写字母开头，仅支持小写字母、数字、_ 和 -") }]}><Input /></Form.Item>
              <QueryState loading={categoryDirectory.isLoading} error={categoryDirectory.error} onRetry={() => categoryDirectory.refetch({ throwOnError: true })}>
              <Row gutter={16}><Col span={12}><Form.Item name="categoryCode" label={t("默认空间品类")} extra={t("用于创建首个默认经营空间；该空间创建后品类固定。")} rules={[{ required: true }]}><Select showSearch filterOption={false}
                onSearch={value => setCategorySearch(value.slice(0, 100))} options={categoryOptions} onChange={code => selectCategory(code)} /></Form.Item></Col>
              <Col span={12}><Form.Item name="currency" label={t("结算币种")} extra={t("订单、报价与配置金额的币种，跟随租户；新建经营空间时以此为默认值。")} rules={[{ required: true }]}><Select options={RENTAL_CURRENCY_CODES.map((code) => ({ value: code, label: `${code} · ${t(RENTAL_CURRENCY_META[code].label)}` }))} /></Form.Item></Col></Row>
              {categoryDirectory.data?.source === "published" && <Form.Item name="categoryVersionId" label={t("采用品类版本")} rules={[{ required: true }]}><Select options={versionOptions(selectedTenantCategory)}/></Form.Item>}
              {categoryDirectory.data?.truncated && <Alert type="info" title={t("还有更多版本，请按品类名称或编码搜索")}/>}
              </QueryState>
              </FormSection> },
              { key: "admin", label: t("租户管理员"), content: <FormSection title={t("租户管理员")}>
              <Form.Item name="adminAccount" label={t("租户管理员账号")} rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="adminDisplayName" label={t("租户管理员姓名")} rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="adminPhone" label={t("联系电话")}><Input /></Form.Item>
              </FormSection> },
              { key: "location", label: t("首个履约地点"), content: <FormSection title={t("首个履约地点")}>
              <Form.Item name="storeName" label={t("首个履约地点")}><Input /></Form.Item>
              <Form.Item name="storeCode" label={t("门店编码")}><Input /></Form.Item>
              <Typography.Paragraph type="secondary">{t("履约地点可暂不创建，稍后在租户开业配置中补齐。")}</Typography.Paragraph>
              </FormSection> },
            ]} />
          )}
          {editor?.type === "edit" && <><Form.Item name="tenantName" label={t("租户名称")} rules={[{ required: true }]}><Input /></Form.Item>{shortNameField}</>}
          {editor?.type === "status" && (
            <>
              <Form.Item name="status" label={t("目标状态")} rules={[{ required: true }]}><Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: t(meta.label) }))} /></Form.Item>
              <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, min: 3 }]}><Input.TextArea rows={4} /></Form.Item>
              <Typography.Paragraph type="secondary">{t("冻结或停用会立即撤销该租户所有登录会话；恢复为正常后账号可重新登录。")}</Typography.Paragraph>
            </>
          )}
        </Form>
        {createTenant.error && editor?.type === "create" && <Alert type="error" title={t("未能确认初始化结果，请刷新租户列表核对后再操作。")} showIcon />}
      </Modal>

      <Drawer
        title={workspaceTenant ? `${workspaceTenant.tenantName} · ${t("经营空间")}` : t("经营空间")}
        size={820}
        open={Boolean(workspaceTenant)}
        destroyOnHidden
        onClose={() => { setWorkspaceTenant(undefined); setWorkspaceEditor(undefined); }}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openWorkspaceCreate}>{t("新增经营空间")}</Button>}
      >
        <Typography.Paragraph type="secondary">{t("每个空间只有一个经营品类。空间已有经营事实后不能原地换品类；需要新建空间并单独配置商品、资产、定价与成员。")}</Typography.Paragraph>
        <QueryState loading={workspaces.isLoading} error={workspaces.error} onRetry={() => workspaces.refetch({ throwOnError: true })}>
          <Table<BusinessWorkspace>
            rowKey="id"
            pagination={false}
            onRefresh={() => workspaces.refetch()} loading={workspaces.isLoading} refreshing={workspaces.isFetching} dataSource={workspaces.data ?? []}
            columns={[
              { title: t("空间"), render: (_, row) => <DataTableText primary={row.name} secondary={row.code} /> },
              { title: t("经营品类"), width: 150, render: (_, row) => t(categoryNames.get(row.categoryCode) ?? row.categoryCode) },
              { title: t("属性"), width: 100, render: (_, row) => row.isDefault ? <Tag color="processing">{t("默认空间")}</Tag> : t("普通空间") },
              { title: t("状态"), width: 100, render: (_, row) => <Tag color={row.status === "active" ? "success" : row.status === "frozen" ? "warning" : "default"}>{t(row.status === "active" ? "正常" : row.status === "frozen" ? "冻结" : "停用")}</Tag> },
              { title: t("操作"), width: 90, render: (_, row) => <Button type="link" onClick={() => openWorkspaceEdit(row)}>{t("编辑")}</Button> }
            ]}
          />
        </QueryState>
      </Drawer>

      <Modal
        title={workspaceEditor?.type === "create" ? t("新增经营空间") : t("编辑经营空间")}
        width={520}
        open={workspaceDialog.visible}
        destroyOnHidden
        onCancel={closeWorkspaceEditor}
        afterClose={workspaceDialog.afterClose}
        closable={!workspaceSaving} keyboard={!workspaceSaving} maskClosable={!workspaceSaving}
        footer={<><Button disabled={workspaceSaving} onClick={closeWorkspaceEditor}>{t("取消")}</Button><SaveButton label={t("保存")} form={workspaceForm} pending={workspaceSaving}
          disabled={workspaceEditor?.type === "create" && (!categoryDirectory.data || Boolean(categoryDirectory.error))} onSave={submitWorkspace} /></>}
      >
        <Form form={workspaceForm} layout="vertical" disabled={workspaceSaving} onFinish={values => { void submitWorkspace(values).catch(() => undefined); }}>
          {workspaceEditor?.type === "create" && <Form.Item name="code" label={t("空间编码")} extra={t("创建后不可修改；同一租户内唯一。")} rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_-]{1,31}$/, message: t("以小写字母开头，仅支持小写字母、数字、_ 和 -") }]}><Input /></Form.Item>}
          <Form.Item name="name" label={t("空间名称")} rules={[{ required: true }]}><Input /></Form.Item>
          {workspaceEditor?.type === "create" && <QueryState loading={categoryDirectory.isLoading} error={categoryDirectory.error} onRetry={() => categoryDirectory.refetch({ throwOnError: true })}>
            <Form.Item name="categoryCode" label={t("经营品类")} extra={t("创建后固定，不能通过编辑资料直接切换。")} rules={[{ required: true }]}><Select showSearch filterOption={false}
              onSearch={value => setCategorySearch(value.slice(0, 100))} options={categoryOptions} onChange={code => selectCategory(code, true)} /></Form.Item>
            {categoryDirectory.data?.source === "published" && <Form.Item name="categoryVersionId" label={t("采用品类版本")} rules={[{ required: true }]}><Select options={versionOptions(selectedWorkspaceCategory)}/></Form.Item>}
            {categoryDirectory.data?.truncated && <Alert type="info" title={t("还有更多版本，请按品类名称或编码搜索")}/>}
          </QueryState>}
          {workspaceEditor?.type === "edit" && <Form.Item label={t("经营品类")}><Input readOnly value={categoryNames.get(workspaceEditor.workspace.categoryCode) ?? workspaceEditor.workspace.categoryCode}/></Form.Item>}
          {workspaceEditor?.type === "edit" && <Form.Item name="status" label={t("空间状态")} rules={[{ required: true }]}><Select options={[{ value: "active", label: t("正常") }, { value: "frozen", label: t("冻结") }, { value: "disabled", label: t("停用") }]} /></Form.Item>}
        </Form>
      </Modal>
    </>
  );
}

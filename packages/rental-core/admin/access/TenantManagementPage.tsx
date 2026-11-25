/** Rental 供给原租户初始化字段与经营空间管理。创建沿原 bootstrap 事务，
 * 不把公共建租户和业务开业拆成前端两次写入；公共列表与生命周期由同源呈现负责。 */
import type { BusinessWorkspace, CreateBusinessWorkspaceRequest, UpdateBusinessWorkspaceRequest } from "@rental-os/rental-core";
import type { TenantSummary } from "@rental-os/rental-core/auth-contracts";
import type { TenantBootstrapRequest, TenantBootstrapResult } from "@rental-os/rental-core/tenant-bootstrap-contracts";
import type { RentalCategoryOpeningOptions, RentalCategoryOpeningOptionsQuery } from "@rental-os/rental-core/category-governance";
import { RENTAL_CURRENCY_CODES, RENTAL_CURRENCY_META } from "@rental-os/rental-core";
import { PublicTenantManagementPage, type PublicTenantBusiness, type PublicManagementRouteProps, type ManagementHeading } from "@rental-os/platform-admin/access";
import { useAdminRuntime, useAdminSession } from "@rental-os/platform-admin/runtime";
import { useLocale } from "@rental-os/platform-admin/locale";
import { QueryState } from "@rental-os/platform-admin/shell";
import { Alert, App, Button, DataTableText, Drawer, Form, FormSection, Input, Modal, SaveButton, Select, Table } from "@rental-os/platform-admin/ui";
import { PlusOutlined } from "@rental-os/platform-admin/ui";
import { useModalDismissal } from "@rental-os/platform-admin/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, Row, Tag, Typography } from "antd";
import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";

type WorkspaceEditor = { type: "create" } | { type: "edit"; workspace: BusinessWorkspace } | undefined;
export function RentalTenantManagementPage(props: PublicManagementRouteProps & { Heading?: ManagementHeading; coreAccess?: boolean }) {
  const runtime = useAdminRuntime(), { user, sessionVerified } = useAdminSession(), { t, locale } = useLocale(), { message } = App.useApp();
  const epoch = runtime.currentSessionEpoch(), queryClient = useQueryClient();
  const operator = user?.displayName ?? t("SaaS 平台管理员");
  const lifetime = useRef<AbortController | null>(null);
  useLayoutEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, [epoch]);
  const current = () => {
    const live = runtime.getSession();
    if (!lifetime.current || lifetime.current.signal.aborted || runtime.currentSessionEpoch() !== epoch || !live.sessionVerified
      || !live.user?.isSaasAdmin || !(live.user.permissions?.includes("*") || live.user.permissions?.includes("system:tenant:manage"))) throw new DOMException("原租户管理页面已失效", "AbortError");
    return AbortSignal.any([lifetime.current.signal, runtime.currentSessionSignal()]);
  };
  const [creating, setCreating] = useState(false), [workspaceTenant, setWorkspaceTenant] = useState<TenantSummary>();
  const [workspaceEditor, setWorkspaceEditor] = useState<WorkspaceEditor>();
  const [categorySearch, setCategorySearch] = useState("");
  const deferredCategorySearch = useDeferredValue(categorySearch);
  const [form] = Form.useForm<Record<string, unknown>>();
  const [workspaceForm] = Form.useForm<CreateBusinessWorkspaceRequest & UpdateBusinessWorkspaceRequest>();
  const workspaceDialog = useModalDismissal(Boolean(workspaceEditor), () => { setWorkspaceEditor(undefined); workspaceForm.resetFields(); });
  const pending = useRef<Promise<unknown> | null>(null);
  const selectedTenantCategory = Form.useWatch("categoryCode", form);
  const selectedWorkspaceCategory = Form.useWatch("categoryCode", workspaceForm);
  const categoryTarget = creating ? undefined : workspaceTenant?.tenantId;
  const tenantKey = ["public-management", epoch, "tenants"] as const;
  const readTenants = (signal: AbortSignal) => runtime.request<TenantSummary[]>("/platform/tenants", { signal });
  const tenants = useQuery({ queryKey: tenantKey, queryFn: ({ signal }) => readTenants(signal), enabled: sessionVerified && Boolean(user?.isSaasAdmin), meta: { liveRefresh: false } });
  const categoryDirectory = useQuery({ queryKey: ["saas-category-opening-options", epoch, categoryTarget, deferredCategorySearch],
    queryFn: async ({ signal }) => {
      current();
      const params: RentalCategoryOpeningOptionsQuery = { tenantId: categoryTarget, search: deferredCategorySearch || undefined };
      const result = await runtime.request<RentalCategoryOpeningOptions>("/platform/tenant-bootstrap/category-options", { params, signal });
      if (result.structureVersion !== 1 || !["published", "builtin_demo"].includes(result.source) || !Array.isArray(result.options)
        || result.options.length > 100 || result.source === "published" && result.options.some(option => !option.versionId)) throw new Error("Unsupported rental category options");
      return result;
    }, enabled: creating || workspaceDialog.visible && workspaceEditor?.type === "create", meta: { liveRefresh: false } });
  const workspaces = useQuery({ queryKey: ["saas-tenant-workspaces", epoch, workspaceTenant?.tenantId],
    queryFn: ({ signal }) => { current(); return runtime.request<BusinessWorkspace[]>("/platform/tenants/" + encodeURIComponent(workspaceTenant!.tenantId) + "/workspaces", { signal }); },
    enabled: Boolean(workspaceTenant), meta: { liveRefresh: false } });
  const refreshWorkspaces = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: tenantKey }, { throwOnError: true }),
    queryClient.invalidateQueries({ queryKey: ["saas-tenant-workspaces", epoch, workspaceTenant?.tenantId] }, { throwOnError: true }),
  ]);
  async function refreshAfter() {
    try { await refreshWorkspaces(); } catch { if (!lifetime.current?.signal.aborted && epoch === runtime.currentSessionEpoch()) message.warning(t("变更已记录，请返回目录重新读取当前状态。")); }
  }
  const createWorkspace = useMutation({
    mutationFn: (values: CreateBusinessWorkspaceRequest) => {
      const signal = current();
      if (!workspaceTenant || !categoryDirectory.data || categoryDirectory.error || createWorkspace.error) throw new Error(t("经营空间创建失败，请检查编码和品类"));
      return runtime.request<BusinessWorkspace>("/platform/tenants/" + encodeURIComponent(workspaceTenant.tenantId) + "/workspaces", { method: "post", data: values, signal, retryAuthentication: false });
    },
    onSuccess: async () => { current(); closeWorkspaceEditor(); message.success(t("经营空间已创建，租户管理员已自动加入")); await refreshAfter(); },
    onError: () => { if (!lifetime.current?.signal.aborted && epoch === runtime.currentSessionEpoch()) message.error(t("经营空间创建失败，请检查编码和品类")); },
  });
  const saveWorkspace = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UpdateBusinessWorkspaceRequest }) => {
      const signal = current();
      if (!workspaceTenant) throw new Error("Workspace editor unavailable");
      return runtime.request<BusinessWorkspace>("/platform/tenants/" + encodeURIComponent(workspaceTenant.tenantId) + "/workspaces/" + encodeURIComponent(id), { method: "put", data: values, signal, retryAuthentication: false });
    },
    onSuccess: async () => { current(); closeWorkspaceEditor(); message.success(t("经营空间已更新")); await refreshAfter(); },
    onError: () => { if (!lifetime.current?.signal.aborted && epoch === runtime.currentSessionEpoch()) message.error(t("经营空间更新失败")); },
  });
  function closeWorkspaceEditor() { workspaceDialog.dismiss(); }
  function openWorkspaceCreate() {
    current(); setCategorySearch(""); createWorkspace.reset(); workspaceForm.resetFields();
    workspaceForm.setFieldsValue({ code: "", name: "", categoryCode: undefined, status: "active" }); setWorkspaceEditor({ type: "create" });
  }
  function openWorkspaceEdit(workspace: BusinessWorkspace) {
    current(); workspaceForm.resetFields(); workspaceForm.setFieldsValue({ name: workspace.name, status: workspace.status }); setWorkspaceEditor({ type: "edit", workspace });
  }
  function submitWorkspace(values: CreateBusinessWorkspaceRequest & UpdateBusinessWorkspaceRequest): Promise<unknown> {
    if (pending.current) return pending.current;
    const operation = Promise.resolve().then(() => {
      current();
      if (workspaceEditor?.type === "create") return createWorkspace.mutateAsync({ code: values.code, name: values.name ?? "", categoryCode: values.categoryCode, categoryVersionId: values.categoryVersionId });
      if (workspaceEditor?.type === "edit") return saveWorkspace.mutateAsync({ id: workspaceEditor.workspace.id, values: { name: values.name, status: values.status } });
      throw new Error("Workspace editor unavailable");
    }).finally(() => { if (pending.current === operation) pending.current = null; });
    pending.current = operation; return operation;
  }
  const categoryNames = useMemo(() => new Map([...(tenants.data ?? []).filter(tenant => tenant.categoryName).map(tenant => [tenant.categoryCode, tenant.categoryName!] as const),
    ...(categoryDirectory.data?.options ?? []).map(option => [option.categoryCode, locale === "en-US" && option.nameEn ? option.nameEn : option.name] as const)]), [tenants.data, categoryDirectory.data, locale]);
  const categoryOptions = [...new Map((categoryDirectory.data?.options ?? []).map(option => [option.categoryCode,
    { value: option.categoryCode, label: locale === "en-US" && option.nameEn ? option.nameEn : option.name }])).values()];
  const versionsFor = (code: unknown) => (categoryDirectory.data?.options ?? []).filter(option => option.categoryCode === code && option.versionId);
  const versionOptions = (code: unknown) => versionsFor(code).map(option => ({ value: option.versionId!, label: option.versionLabel + (option.recommended ? " · " + t("默认推荐版本") : "") }));
  const selectCategory = (code: unknown, workspace = false) => {
    const versions = versionsFor(code), selected = versions.find(version => version.recommended) ?? (versions.length === 1 ? versions[0] : undefined);
    if (workspace) workspaceForm.setFieldValue("categoryVersionId", selected?.versionId); else form.setFieldValue("categoryVersionId", selected?.versionId);
  };
  const workspaceSaving = createWorkspace.isPending || saveWorkspace.isPending;
  const business: PublicTenantBusiness<TenantSummary> = {
    tenants: readTenants, assertCurrent: () => { current(); },
    initialValues: { categoryCode: undefined, currency: "CNY", storeName: "", storeCode: "" },
    onCreatingChange: value => { if (value) setCategorySearch(""); setCreating(value); },
    createUnavailable: !categoryDirectory.data || Boolean(categoryDirectory.error),
    async createTenant(values, signal) {
      current();
      const input = values as unknown as TenantBootstrapRequest;
      const result = await runtime.request<TenantBootstrapResult>("/platform/tenant-bootstrap", { method: "post", signal, retryAuthentication: false,
        data: { ...input, storeName: input.storeName?.trim() || undefined, storeCode: input.storeCode?.trim() || undefined, operator } });
      current();
      return { tenant: result.tenant, admin: result.adminUser, temporaryPassword: result.temporaryPassword };
    },
    tenantFields: <>              <QueryState loading={categoryDirectory.isLoading} error={categoryDirectory.error} onRetry={() => categoryDirectory.refetch({ throwOnError: true })}>
              <Row gutter={16}><Col span={12}><Form.Item name="categoryCode" label={t("默认空间品类")} extra={t("用于创建首个默认经营空间；该空间创建后品类固定。")} rules={[{ required: true }]}><Select showSearch filterOption={false}
                onSearch={value => setCategorySearch(value.slice(0, 100))} options={categoryOptions} onChange={code => selectCategory(code)} /></Form.Item></Col>
              <Col span={12}><Form.Item name="currency" label={t("结算币种")} extra={t("订单、报价与配置金额的币种，跟随租户；新建经营空间时以此为默认值。")} rules={[{ required: true }]}><Select options={RENTAL_CURRENCY_CODES.map((code) => ({ value: code, label: `${code} · ${t(RENTAL_CURRENCY_META[code].label)}` }))} /></Form.Item></Col></Row>
              {categoryDirectory.data?.source === "published" && <Form.Item name="categoryVersionId" label={t("采用品类版本")} rules={[{ required: true }]}><Select options={versionOptions(selectedTenantCategory)}/></Form.Item>}
              {categoryDirectory.data?.truncated && <Alert type="info" title={t("还有更多版本，请按品类名称或编码搜索")}/>}
              </QueryState></>,
    locationSection: { key: "location", label: t("首个履约地点"), content: <FormSection title={t("首个履约地点")}>
              <Form.Item name="storeName" label={t("首个履约地点")}><Input /></Form.Item>
              <Form.Item name="storeCode" label={t("门店编码")}><Input /></Form.Item>
              <Typography.Paragraph type="secondary">{t("履约地点可暂不创建，稍后在租户开业配置中补齐。")}</Typography.Paragraph>
              </FormSection> },
    createdDetails: result => [{ key: "category", label: t("默认经营空间品类"), children: result.tenant.categoryCode }],
    renderWorkspaceSummary: row => <DataTableText primary={row.workspaceCount == null ? "—" : row.workspaceCount + " " + t("个")}
      secondary={row.workspaceCategoryCodes?.map(code => t(categoryNames.get(code) ?? code)).join(" · ")} />,
    orderCount: row => row.orderCount,
    openWorkspaces: tenant => { current(); setWorkspaceTenant(tenant); },
    workspaceManager: <>      <Drawer
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
      </Modal></>,
  };
  return <PublicTenantManagementPage {...props} form={form} business={business} />;
}

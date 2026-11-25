/** 原 SaaS 租户列表、生命周期弹窗与创建侧窗。业务字段/空间管理来自所选 Core，
 * 零 Core 只创建公共主体；一次性口令保留在原成功弹窗，不进入缓存。 */
import type { CreatePlatformTenantRequest, PlatformTenantSummary, SystemUserRow, UpdateTenantStatusRequest } from "@rental-os/platform-contracts";
import { TenantStatus } from "@rental-os/platform-contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Descriptions, Space, Tag, Typography, type DescriptionsProps, type FormInstance } from "antd";
import { Boxes, Building2, KeyRound, Pencil, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ADMIN_TABLE_COLUMN_WIDTH } from "../../app/designTokens";
import { useLocale } from "../../app/locale";
import { canManagePublicResource } from "../../application-access";
import { QueryState } from "../../components/QueryState";
import { SettingsWorkspace, type SettingsSection } from "../../components/settings/SettingsWorkspace";
import { Alert, App, Button, CopyButton, DataTableRowActions, DataTableText, Form, FormSection, Input,
  ListFilterItem, ListFilters, ListSection, Modal, Result, SaveButton, Select, Table, useListFilter } from "../../components/ui";
import { PlusOutlined } from "../../components/ui/icons";
import { useModalDismissal } from "../../components/ui/useModalDismissal";
import { useAdminSession } from "../../runtime";
import { ManagementPageHeading, type ManagementHeading } from "./management-adapter";
import { usePublicManagementApi } from "./management-client";
import { useManagementLifetime } from "./management-lifetime";

export interface PublicTenantCreated<Tenant extends PlatformTenantSummary = PlatformTenantSummary> {
  tenant: Tenant; admin: Pick<SystemUserRow, "account">; temporaryPassword?: string; message?: string;
}
export interface PublicTenantBusiness<Tenant extends PlatformTenantSummary = PlatformTenantSummary> {
  tenants(signal: AbortSignal): Promise<Tenant[]>;
  assertCurrent(): void;
  initialValues: Record<string, unknown>;
  onCreatingChange(creating: boolean): void;
  createUnavailable: boolean;
  createTenant(values: Record<string, unknown>, signal: AbortSignal): Promise<PublicTenantCreated<Tenant>>;
  tenantFields: ReactNode;
  locationSection: SettingsSection;
  createdDetails(result: PublicTenantCreated<Tenant>): NonNullable<DescriptionsProps["items"]>;
  renderWorkspaceSummary(tenant: Tenant): ReactNode;
  orderCount(tenant: Tenant): number | undefined;
  openWorkspaces(tenant: Tenant): void;
  workspaceManager: ReactNode;
}
const statusMeta = {
  [TenantStatus.Active]: { label: "正常", color: "success" },
  [TenantStatus.Frozen]: { label: "冻结", color: "warning" },
  [TenantStatus.Disabled]: { label: "停用", color: "default" },
} as const;

type Editor<Tenant> = { type: "create" } | { type: "edit"; tenant: Tenant } | { type: "status"; tenant: Tenant } | undefined;
export function PublicTenantManagementPage<Tenant extends PlatformTenantSummary = PlatformTenantSummary>({
  Heading = ManagementPageHeading, business, form: providedForm, routeEdit = false, routeStatus = false, coreAccess = true,
}: { Heading?: ManagementHeading; business?: PublicTenantBusiness<Tenant>; form?: FormInstance<Record<string, unknown>>; routeEdit?: boolean; routeStatus?: boolean; coreAccess?: boolean }) {
  const { message, modal } = App.useApp(), { t } = useLocale();
  const api = usePublicManagementApi(), queryClient = useQueryClient(), life = useManagementLifetime("saas", "system:tenant:manage");
  const { user } = useAdminSession(), navigate = useNavigate(), { id } = useParams();
  const [filter, setFilter] = useState("all"), [editor, setEditor] = useState<Editor<Tenant>>();
  const [form] = Form.useForm<Record<string, unknown>>(providedForm);
  const pending = useRef<Promise<unknown> | null>(null), routeOpened = useRef<string | undefined>(undefined);
  const editorDialog = useModalDismissal(Boolean(editor), () => {
    setEditor(undefined); form.resetFields(); business?.onCreatingChange(false);
    if (routeEdit) navigate("/platform/tenants");
  });
  const key = ["public-management", life.epoch, "tenants"] as const;
  const tenants = useQuery({ queryKey: key, queryFn: ({ signal }) => business
    ? business.tenants(signal) : api.tenants(signal) as Promise<Tenant[]>, meta: { liveRefresh: false } });
  const rows = useMemo(() => (tenants.data ?? []).filter(tenant => tenant.tenantCode !== "platform" && (filter === "all" || tenant.tenantStatus === filter)), [tenants.data, filter]);
  const tenantFilter = useListFilter(rows, { fields: row => [row.tenantName, row.tenantCode] });
  const canCreate = canManagePublicResource(user, "saas", "system:tenant:bootstrap");
  function current() { const signal = life.current(); business?.assertCurrent(); return signal; }
  const refresh = () => queryClient.invalidateQueries({ queryKey: key }, { throwOnError: true });
  async function refreshAfter() {
    try { await refresh(); } catch { if (life.isCurrent()) message.warning(t("变更已记录，请返回目录重新读取当前状态。")); }
  }
  const createTenant = useMutation({
    mutationFn: async (values: Record<string, unknown>): Promise<PublicTenantCreated> => {
      const signal = current();
      if (!canManagePublicResource(life.runtime.getSession().user, "saas", "system:tenant:bootstrap")
        || createTenant.error || tenants.error || !tenants.data || business?.createUnavailable) throw new Error(t("请先读取并核对当前资料。"));
      if (business) return business.createTenant(values, signal);
      const payload: CreatePlatformTenantRequest = { tenantCode: String(values.tenantCode ?? ""), tenantName: String(values.tenantName ?? ""),
        adminAccount: String(values.adminAccount ?? ""), adminDisplayName: String(values.adminDisplayName ?? ""), adminPhone: typeof values.adminPhone === "string" ? values.adminPhone : undefined };
      return api.createTenant(payload, signal);
    },
    onSuccess: async result => {
      current(); closeEditor();
      modal.success({ title: t("SaaS 租户已初始化"), width: 560, content: <Descriptions column={1} size="small" bordered items={[
        { key: "tenant", label: t("租户"), children: result.tenant.tenantName + " (" + result.tenant.tenantCode + ")" },
        ...(business ? business.createdDetails(result as PublicTenantCreated<Tenant>) : []),
        { key: "account", label: t("管理员账号"), children: result.admin.account },
        { key: "password", label: t("一次性临时密码"), children: <Typography.Text code copyable>{result.temporaryPassword}</Typography.Text> },
      ]} /> });
      await refreshAfter();
    },
    onError: () => { if (life.isCurrent()) message.error(t("未能确认初始化结果，请刷新租户列表核对后再操作。")); },
  });
  const saveTenant = useMutation({
    mutationFn: ({ id: tenantId, tenantName }: { id: string; tenantName: string }) => api.updateTenant(tenantId, { tenantName }, current()),
    onSuccess: async () => { current(); closeEditor(); message.success(t("租户资料已更新")); await refreshAfter(); },
    onError: () => { if (life.isCurrent()) message.error(t("租户资料更新失败")); },
  });
  const changeStatus = useMutation({
    mutationFn: ({ id: tenantId, payload }: { id: string; payload: UpdateTenantStatusRequest }) => api.updateTenantStatus(tenantId, payload, current()),
    onSuccess: async () => { current(); closeEditor(); message.success(t("租户状态已更新，相关会话已按规则处理")); await refreshAfter(); },
    onError: () => { if (life.isCurrent()) message.error(t("租户状态更新失败")); },
  });
  const resetTenantAdmin = useMutation({
    mutationFn: (tenantId: string) => api.resetTenantAdminPassword(tenantId, current()),
    onSuccess: result => { current(); modal.success({ title: t("租户管理员密码已重置"), content: <><Typography.Paragraph>{result.message}</Typography.Paragraph><Typography.Text code copyable>{result.temporaryPassword}</Typography.Text></> }); },
    onError: () => { if (life.isCurrent()) message.error(t("租户管理员密码重置失败")); },
  });
  function closeEditor() { editorDialog.dismiss(); }
  async function openCreate() {
    if (!canCreate || !tenants.data || tenants.error) return;
    current();
    if (createTenant.error) {
      try { await tenants.refetch({ throwOnError: true }); current(); }
      catch { if (life.isCurrent()) message.error(t("未能确认初始化结果，请刷新租户列表核对后再操作。")); return; }
    }
    form.resetFields(); createTenant.reset(); business?.onCreatingChange(true);
    form.setFieldsValue({ tenantCode: "", tenantName: "", adminAccount: "admin", adminDisplayName: "租户管理员", ...business?.initialValues });
    setEditor({ type: "create" });
  }
  function openEdit(tenant: Tenant) { current(); form.resetFields(); form.setFieldsValue({ tenantName: tenant.tenantName }); setEditor({ type: "edit", tenant }); }
  function openStatus(tenant: Tenant) { current(); form.resetFields(); form.setFieldsValue({ status: tenant.tenantStatus, reason: "" }); setEditor({ type: "status", tenant }); }
  function confirmResetAdmin(tenant: Tenant) {
    current(); modal.confirm({ title: t("重置租户管理员密码") + " “" + tenant.tenantName + "”？", content: t("系统会生成一次性临时密码，并使该管理员的既有登录会话失效。"),
      okText: t("确认重置"), onOk: () => resetTenantAdmin.mutateAsync(tenant.tenantId) });
  }
  function submit(values: Record<string, unknown>): Promise<unknown> {
    if (pending.current) return pending.current;
    const operation = Promise.resolve().then<unknown>(() => {
      current();
      if (tenants.error || !tenants.data) throw new Error(t("请先读取并核对当前资料。"));
      if (editor?.type === "create") return createTenant.mutateAsync(values);
      if (editor?.type === "edit") return saveTenant.mutateAsync({ id: editor.tenant.tenantId, tenantName: String(values.tenantName ?? "") });
      if (editor?.type === "status") return changeStatus.mutateAsync({ id: editor.tenant.tenantId, payload: { status: values.status as TenantStatus, reason: String(values.reason ?? "") } });
      throw new Error("Tenant editor unavailable");
    }).finally(() => { if (pending.current === operation) pending.current = null; });
    pending.current = operation; return operation;
  }
  useEffect(() => {
    if (!routeEdit || !tenants.data || tenants.error) return;
    const target = (id ?? "new") + ":" + routeStatus;
    if (routeOpened.current === target) return;
    const row = id ? tenants.data.find(tenant => tenant.tenantId === id) : undefined;
    if (id && !row) return;
    routeOpened.current = target;
    if (row) { if (routeStatus) openStatus(row); else openEdit(row); } else openCreate();
  }, [routeEdit, routeStatus, id, tenants.data, tenants.error]);
  const saving = createTenant.isPending || saveTenant.isPending || changeStatus.isPending;
  if (routeEdit && id && tenants.data && !tenants.data.some(row => row.tenantId === id)) return <Result status="404" title="404" />;
  return <>
    <Heading title={t("SaaS 租户")} extra={canCreate ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("新增 SaaS 租户")}</Button> : undefined} />
    <QueryState loading={tenants.isLoading} error={tenants.error} onRetry={() => tenants.refetch({ throwOnError: true })}>
      <ListSection controls={<><ListFilters filter={tenantFilter} placeholder="租户名称或编码" hasFilters={filter !== "all"} onClear={() => { tenantFilter.clear(); setFilter("all"); }} /><ListFilterItem label={t("租户状态")} priority active={filter !== "all"}><Select aria-label={t("租户状态")} value={filter}
        onChange={value => { setFilter(String(value)); tenantFilter.pagination.onChange(1, tenantFilter.pagination.pageSize); }} options={[
          { label: t("全部状态"), value: "all" }, { label: t("正常"), value: TenantStatus.Active }, { label: t("冻结"), value: TenantStatus.Frozen }, { label: t("停用"), value: TenantStatus.Disabled },
        ]} /></ListFilterItem></>}>
        <Table<Tenant> rowKey="tenantId" onRefresh={() => tenants.refetch()} loading={tenants.isLoading} refreshing={tenants.isFetching} dataSource={tenantFilter.rows} pagination={tenantFilter.pagination} scroll={{ x: 1120 }} columns={[
          { title: t("租户"), fixed: "left", minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity, render: (_, row) => <DataTableText primary={row.tenantName} secondary={row.tenantCode} /> },
          ...(business ? [{ title: t("经营空间"), minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity, render: (_: unknown, row: Tenant) => business.renderWorkspaceSummary(row) }] : []),
          { title: t("状态"), width: 100, dataIndex: "tenantStatus", render: (value: TenantStatus) => <Tag color={statusMeta[value].color}>{t(statusMeta[value].label)}</Tag> },
          { title: t("专属登录链接"), width: 280, render: (_, row) => {
            const url = new URL("/login/" + encodeURIComponent(row.tenantCode), window.location.origin).href;
            return <Space size={4}><a href={url} target="_blank" rel="noopener noreferrer" title={url}>{t("登录页")}</a><CopyButton value={url} label={t("复制登录链接")} /></Space>;
          } },
          { title: t("组织"), width: 90, dataIndex: "organizationCount" },
          { title: t("账号"), width: 90, dataIndex: "userCount" },
          ...(business ? [{ title: t("订单"), width: 90, render: (_: unknown, row: Tenant) => business.orderCount(row) }] : []),
          { title: t("状态原因"), dataIndex: "statusReason", render: value => value || "—" },
          { title: t("创建时间"), width: 170, dataIndex: "createdAt", render: value => value ? new Date(value).toLocaleString() : "—" },
          { title: t("操作"), fixed: "right", render: (_, row) => <DataTableRowActions details={() => openEdit(row)} detailLabel={t("编辑资料")} menuLabel={row.tenantName + " · " + t("更多操作")}
            primary={business ? { id: "workspaces", label: t("经营空间"), icon: Building2, onSelect: () => business.openWorkspaces(row) } : { id: "edit", label: t("编辑资料"), icon: Pencil, onSelect: () => openEdit(row) }} actions={[
              { id: "edit", label: t("编辑资料"), icon: Pencil, onSelect: () => openEdit(row) },
              { id: "status", label: t("变更租户状态"), icon: ShieldCheck, onSelect: () => openStatus(row) },
              { id: "reset", label: t("重置管理员密码"), icon: KeyRound, disabled: resetTenantAdmin.isPending, onSelect: () => confirmResetAdmin(row) },
              ...(coreAccess ? [{ id: "core-access", label: t("Core 授权"), icon: Boxes, onSelect: () => navigate("/platform/core-access?" + new URLSearchParams({ target: row.tenantId })) }] : []),
            ]} /> },
        ]} />
      </ListSection>
    </QueryState>
    <Modal presentation={editor?.type === "create" ? "side" : "dialog"} title={editor?.type === "create" ? t("初始化 SaaS 租户") : editor?.type === "edit" ? t("编辑租户资料") : t("变更租户状态")}
      width={editor?.type === "create" ? 720 : 520} open={editorDialog.visible} destroyOnHidden onCancel={closeEditor} afterClose={editorDialog.afterClose}
      closable={!saving} keyboard={!saving} maskClosable={!saving}
      footer={<><Button disabled={saving} onClick={closeEditor}>{t("取消")}</Button><SaveButton label={t(editor?.type === "create" ? "创建租户" : "保存")} form={form} pending={saving}
        disabled={editor?.type === "create" && (Boolean(createTenant.error) || Boolean(business?.createUnavailable))} onSave={submit} /></>}>
      {editor && editor.type !== "create" && <Typography.Paragraph type="secondary">{editor.tenant.tenantName} · {editor.tenant.tenantCode}</Typography.Paragraph>}
      <Form form={form} layout="vertical" disabled={saving} onFinish={values => { void submit(values).catch(() => undefined); }}>
        {editor?.type === "create" && <SettingsWorkspace sections={[
          { key: "tenant", label: t("租户资料"), content: <FormSection title={t("租户资料")}>
            <Form.Item name="tenantName" label={t("租户名称")} rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="tenantCode" label={t("租户编码")} extra={t("创建后不可修改，用于登录和数据隔离。")} rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_-]{1,31}$/, message: t("以小写字母开头，仅支持小写字母、数字、_ 和 -") }]}><Input /></Form.Item>
            {business?.tenantFields}
          </FormSection> },
          { key: "admin", label: t("租户管理员"), content: <FormSection title={t("租户管理员")}>
            <Form.Item name="adminAccount" label={t("租户管理员账号")} rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="adminDisplayName" label={t("租户管理员姓名")} rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="adminPhone" label={t("联系电话")}><Input /></Form.Item>
          </FormSection> },
          ...(business ? [business.locationSection] : []),
        ]} />}
        {editor?.type === "edit" && <Form.Item name="tenantName" label={t("租户名称")} rules={[{ required: true }]}><Input /></Form.Item>}
        {editor?.type === "status" && <>
          <Form.Item name="status" label={t("目标状态")} rules={[{ required: true }]}><Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: t(meta.label) }))} /></Form.Item>
          <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, min: 3 }]}><Input.TextArea rows={4} /></Form.Item>
          <Typography.Paragraph type="secondary">{t("冻结或停用会立即撤销该租户所有登录会话；恢复为正常后账号可重新登录。")}</Typography.Paragraph>
        </>}
      </Form>
      {createTenant.error && editor?.type === "create" && <Alert type="error" title={t("未能确认初始化结果，请刷新租户列表核对后再操作。")} showIcon />}
    </Modal>
    {business?.workspaceManager}
  </>;
}

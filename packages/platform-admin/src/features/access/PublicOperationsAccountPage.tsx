/** 原运营账号列表和编辑侧窗的公共呈现。空间权限由所选 Core 的真实适配供给，
 * 公共账号、状态及密码仍使用原服务端接口；按钮与回车共享一次保存。 */
import type { SaveSystemUserRequest, SystemRoleRow, SystemUserRow } from "@rental-os/platform-contracts";
import { RoleScope } from "@rental-os/platform-contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, Row, Typography } from "antd";
import { KeyRound, Mail, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLocale } from "../../app/locale";
import { formSnapshotFingerprint } from "../../forms";
import { InsightMetrics } from "../../components/InsightMetrics";
import { QueryState } from "../../components/QueryState";
import { SettingsWorkspace, type SettingsSection } from "../../components/settings/SettingsWorkspace";
import { App, Button, CopyButton, DataTableRowActions, DataTableText, Drawer, Form, FormSection,
  Input, ListFilters, ListSection, Result, SaveButton, Select, Switch, Table, useListFilter } from "../../components/ui";
import { PlusOutlined } from "../../components/ui/icons";
import { useAdminSession } from "../../runtime";
import { ManagementPageHeading, type ManagementHeading } from "./management-adapter";
import { usePublicManagementApi } from "./management-client";
import { useManagementLifetime } from "./management-lifetime";
import accessStyles from "./TenantAccess.module.css";
import { PublicMemberInvitations } from "./PublicMemberInvitations";

type AccountForm = Omit<SaveSystemUserRequest, "roleIds"> & { roleId?: string };
export interface PublicUserBusinessAccess {
  loading: boolean;
  error: unknown;
  ready: boolean;
  assertCurrent(): void;
  openEditor(user: SystemUserRow | undefined, defaultRoleId: string | undefined, roles: SystemRoleRow[]): void;
  saveUser(values: SaveSystemUserRequest, signal: AbortSignal): Promise<SystemUserRow>;
  refresh(): Promise<unknown>;
  renderAccess(user: SystemUserRow): ReactNode;
  editorSection(context: { editing?: SystemUserRow; currentUserId?: string; activeRoles: SystemRoleRow[]; roles: SystemRoleRow[]; classNames: { permissionSummary: string; workspaceFields: string } }): SettingsSection;
  invitations(props: { open: boolean; onClose(): void; roles: SystemRoleRow[] }): ReactNode;
}

export function PublicOperationsAccountPage({ Heading = ManagementPageHeading, business, routeEdit = false, routeAction = false }: {
  Heading?: ManagementHeading; business?: PublicUserBusinessAccess; routeEdit?: boolean; routeAction?: boolean;
}) {
  const { message, modal } = App.useApp(), { t } = useLocale();
  const queryClient = useQueryClient(), api = usePublicManagementApi();
  const life = useManagementLifetime("tenant", "system:user:manage");
  const { user: currentUser } = useAdminSession(), currentUserId = currentUser?.id;
  const key = ["public-management", life.epoch] as const;
  const organizations = useQuery({ queryKey: [...key, "organizations"], queryFn: ({ signal }) => api.organizations(signal), meta: { liveRefresh: false } });
  const users = useQuery({ queryKey: [...key, "users"], queryFn: ({ signal }) => api.users(signal), meta: { liveRefresh: false } });
  const roles = useQuery({ queryKey: [...key, "roles"], queryFn: ({ signal }) => api.roles(signal), meta: { liveRefresh: false } });
  const accountFilter = useListFilter(users.data, { fields: row => [row.account, row.displayName, row.phone, row.organizationName], status: row => row.isActive ? "active" : "disabled" });
  const [form] = Form.useForm<AccountForm>();
  const [editing, setEditing] = useState<SystemUserRow>();
  const [drawerOpen, setDrawerOpen] = useState(false), [invitationOpen, setInvitationOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const needsRead = useRef(false);
  const pending = useRef<Promise<SystemUserRow> | null>(null);
  const baseline = useRef<string | undefined>(undefined);
  const routeOpened = useRef<string | undefined>(undefined), navigate = useNavigate(), { id } = useParams();
  const activeRoles = (roles.data ?? []).filter(role => role.isActive);
  const defaultRoleId = activeRoles.find(role => role.scope === RoleScope.Store && !role.fixedAllPermissions)?.id
    ?? activeRoles.find(role => !role.fixedAllPermissions)?.id ?? activeRoles[0]?.id;
  const loading = organizations.isLoading || users.isLoading || roles.isLoading || Boolean(business?.loading);
  const error = organizations.error ?? users.error ?? roles.error ?? business?.error;
  const ready = Boolean(organizations.data && users.data && roles.data && !error && (!business || business.ready));
  const current = () => { const signal = life.current(); business?.assertCurrent(); return signal; };
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...key, "users"] }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: ["public-core-access-directory", life.epoch] }, { throwOnError: true }),
      business?.refresh(),
    ]);
  };
  const refreshAfter = async () => {
    try { await refresh(); } catch { if (life.isCurrent()) message.warning(t("变更已记录，请返回目录重新读取当前状态。")); }
  };
  const save = useMutation({
    mutationFn: (values: SaveSystemUserRequest) => {
      const signal = current();
      const original = editing && queryClient.getQueryData<SystemUserRow[]>([...key, "users"])?.find(row => row.id === editing.id);
      if (!ready || failed || editing && (!original || formSnapshotFingerprint(original) !== baseline.current))
        throw new Error(t("请先读取并核对当前资料。"));
      const payload = { ...values, id: editing?.id };
      return business ? business.saveUser(payload, signal) : api.saveUser(payload, signal);
    },
    onSuccess: async saved => {
      current();
      setDrawerOpen(false); form.resetFields();
      if (saved.temporaryPassword) {
        modal.success({ title: t("运营账号已创建"), content: <><Typography.Paragraph>{t("请将以下临时密码安全交给账号持有人，首次登录必须修改。")}</Typography.Paragraph><Typography.Text code>{saved.temporaryPassword}</Typography.Text><CopyButton value={saved.temporaryPassword} /></> });
      } else message.success(t(business ? "运营账号与空间权限已保存" : "运营账号已保存"));
      if (routeEdit) navigate("/tenant/accounts");
      await refreshAfter();
    },
    onError: failure => {
      if (!life.isCurrent() || failure instanceof DOMException && failure.name === "AbortError") return;
      needsRead.current = true; setFailed(true); message.error(t(business ? "保存失败，请检查基础角色、空间角色和账号唯一性" : "保存失败，请检查基础角色和账号唯一性"));
    },
  });
  function submit(values: AccountForm) {
    if (pending.current) return pending.current;
    const { roleId, ...rest } = values;
    const operation = save.mutateAsync({ ...rest, roleIds: roleId ? [roleId] : [] }).finally(() => {
      if (pending.current === operation) pending.current = null;
    });
    pending.current = operation; return operation;
  }
  const toggleStatus = useMutation({
    mutationFn: ({ id: userId, isActive }: { id: string; isActive: boolean }) => api.setUserStatus(userId, isActive, current()),
    onSuccess: async () => { current(); message.success(t("账号状态已更新")); await refreshAfter(); },
    onError: () => { if (life.isCurrent()) message.error(t("账号状态更新失败")); },
  });
  const resetPassword = useMutation({
    mutationFn: (userId: string) => api.resetUserPassword(userId, current()),
    onSuccess: result => { current(); modal.success({ title: t("密码已重置"), content: <><Typography.Paragraph>{t(result.message)}</Typography.Paragraph><Typography.Text code>{result.temporaryPassword}</Typography.Text><CopyButton value={result.temporaryPassword} /></> }); },
    onError: () => { if (life.isCurrent()) message.error(t("密码重置失败")); },
  });
  async function openEditor(user?: SystemUserRow) {
    if (!ready || pending.current) return;
    current();
    if (needsRead.current) {
      try {
        const latest = await users.refetch({ throwOnError: true });
        await business?.refresh(); current();
        if (user) { user = latest.data?.find(row => row.id === user?.id); if (!user) return; }
        needsRead.current = false;
      } catch { if (life.isCurrent()) message.error(t("请先读取并核对当前资料。")); return; }
    }
    business?.openEditor(user, defaultRoleId, roles.data ?? []);
    setEditing(user); setFailed(false); baseline.current = user && formSnapshotFingerprint(user);
    form.resetFields();
    form.setFieldsValue(user ? { id: user.id, account: user.account, displayName: user.displayName, phone: user.phone,
      organizationId: user.organizationId, roleId: user.roleIds[0], isPlatformAdmin: user.isPlatformAdmin, isActive: user.isActive }
      : { account: "", displayName: "", roleId: defaultRoleId, isPlatformAdmin: false, isActive: true });
    setDrawerOpen(true);
  }
  function confirmReset(user: SystemUserRow) {
    current();
    modal.confirm({ title: t("重置") + " " + user.account + " " + t("的密码？"), content: t("重置后原登录会话失效，并生成一次性临时密码。"),
      onOk: () => resetPassword.mutateAsync(user.id) });
  }
  useEffect(() => {
    if ((!routeEdit && !routeAction) || !ready) return;
    const target = id ?? "new";
    if (routeOpened.current === target) return;
    const row = id ? users.data?.find(item => item.id === id) : undefined;
    if (id && !row) return;
    routeOpened.current = target;
    if (routeAction && row) confirmReset(row); else openEditor(row);
  }, [routeEdit, routeAction, id, ready, users.data]);
  if ((routeEdit || routeAction) && id && users.data && !users.data.some(row => row.id === id)) return <Result status="404" title="404" />;

  return <>
    <Heading title={t("运营账号管理")} summary={<InsightMetrics items={[{ label: t("账号"), value: accountFilter.rows.length }, { label: t("已启用"), value: accountFilter.rows.filter(row => row.isActive).length }]} />}
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{t("新增运营账号")}</Button>}
      note={{ title: t("权限分为两层"), description: t("角色决定可以执行哪些操作；数据范围决定在获准操作内可以看哪些数据。经营空间访问权单独授予，不能只靠隐藏菜单代替。") }} />
    {business ? business.invitations({ open: invitationOpen, onClose: () => setInvitationOpen(false), roles: roles.data ?? [] })
      : <PublicMemberInvitations open={invitationOpen} onClose={() => setInvitationOpen(false)} />}
    <QueryState loading={loading} error={error}>
      <ListSection controls={<><ListFilters filter={accountFilter} placeholder="账号、姓名或手机号" options={[{ value: "active", label: "已启用" }, { value: "disabled", label: "已停用" }]} /><Button icon={<Mail size={16} aria-hidden="true" />} onClick={() => setInvitationOpen(true)}>{t("邀请运营用户")}</Button></>}>
        <Table<SystemUserRow> toolbarNote={false} rowKey="id" onRefresh={() => users.refetch()} loading={users.isLoading} refreshing={users.isFetching} dataSource={accountFilter.rows} pagination={accountFilter.pagination} scroll={{ x: 1120 }} columns={[
          { title: t("账号"), width: 190, render: (_, record) => <DataTableText primary={record.displayName} secondary={record.account} /> },
          { title: t("手机"), dataIndex: "phone", width: 140, render: value => value || "-" },
          { title: t("归属组织"), dataIndex: "organizationName", width: 160, render: value => value || t("未分配") },
          { title: t("租户基础角色"), dataIndex: "roleNames", width: 180, render: (values: string[]) => values.join("、") || t("未分配") },
          ...(business ? [{ title: t("可访问空间"), width: 250, render: (_: unknown, record: SystemUserRow) => business.renderAccess(record) }] : []),
          { title: t("状态"), width: 100, render: (_, record) => <Switch checked={record.isActive} disabled={record.id === currentUserId} loading={toggleStatus.isPending} onChange={isActive => toggleStatus.mutate({ id: record.id, isActive })} /> },
          { title: t("操作"), fixed: "right", render: (_, record) => <DataTableRowActions primary={{ id: "edit", label: t("编辑授权"), icon: Pencil, onSelect: () => openEditor(record) }} details={() => openEditor(record)} detailLabel={t("编辑授权")} menuLabel={record.account + " · " + t("更多操作")} actions={[{ id: "reset", label: t("重置密码"), icon: KeyRound, onSelect: () => confirmReset(record) }]} /> },
        ]} />
      </ListSection>
    </QueryState>
    <Drawer title={editing ? t("编辑运营账号") : t("新增运营账号")} open={drawerOpen} size="large" destroyOnHidden
      onClose={() => { if (!pending.current) { setDrawerOpen(false); if (routeEdit) navigate("/tenant/accounts"); } }}
      extra={<SaveButton label={t(business ? "保存账号与空间权限" : "保存账号")} form={form} pending={save.isPending} disabled={failed || !ready} onSave={submit} />}>
      <Form<AccountForm> form={form} layout="vertical" onFinish={values => { void submit(values).catch(() => undefined); }}>
        <SettingsWorkspace sections={[
          { key: "profile", label: t("账号资料"), content: <FormSection title={t("账号资料")}>
            <Row gutter={16}>
              <Col span={12}><Form.Item name="displayName" label={t("姓名")} rules={[{ required: true, message: t("请输入姓名") }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="account" label={t("登录账号")} rules={[{ required: true, message: t("请输入登录账号") }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
              <Col span={12}><Form.Item name="phone" label={t("手机号")}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="organizationId" label={t("归属组织")}><Select allowClear options={(organizations.data ?? []).filter(item => item.status === "enabled").map(item => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
              <Col span={12}><Form.Item name="roleId" label={t("租户基础角色")} rules={[{ required: true, message: t("请选择基础角色") }]}><Select options={activeRoles.map(role => ({ value: role.id, label: role.name }))} /></Form.Item></Col>
              <Col span={6}><Form.Item name="isActive" label={t("账号启用")} valuePropName="checked"><Switch /></Form.Item></Col>
              <Col span={6}><Form.Item name="isPlatformAdmin" label={t("租户管理员")} valuePropName="checked"><Switch disabled={editing?.id === currentUserId} /></Form.Item></Col>
            </Row>
          </FormSection> },
          ...(business ? [business.editorSection({ editing, currentUserId, activeRoles, roles: roles.data ?? [], classNames: { permissionSummary: accessStyles.permissionSummary, workspaceFields: accessStyles.workspaceFields } })] : []),
        ]} />
      </Form>
    </Drawer>
  </>;
}

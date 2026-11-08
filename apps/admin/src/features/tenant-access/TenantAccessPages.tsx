import { PermissionEditor, PermissionMatrix } from "./PermissionMatrix";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { Card as ArcCard } from "@/registry/components/card/card";
import { Button as ArcButton } from "@/registry/components/button/button";
import { InsightMetrics } from "@/components/BusinessInsights";
import accessStyles from "./TenantAccess.module.css";
import { AnimatedNumber, DataTableText, Empty, Pagination, Segmented, ListFilterBar, ListFilters, useListFilter } from "@/components/ui";
import { EditOutlined, PlusOutlined } from "@/components/ui/icons";
import type {
  BusinessWorkspace,
  PermissionModule,
  SaveSystemRoleRequest,
  SaveSystemUserAccessRequest,
  SaveSystemUserRequest,
  SystemDataScope,
  SystemRoleRow,
  SystemUserRow,
  WorkspaceMember
} from "@rental-os/shared";
import { RoleScope } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Col, Row, Space, Tag, Typography } from "antd";
import { Accordion, FormSection, ListSection, App } from "@/components/ui";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Input, Switch } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button, ConfirmAction, CopyButton, DataTableRowActions, Drawer, SaveButton } from "@/components/ui";
import { KeyRound, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api/platform";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const DATA_SCOPE_OPTIONS: Array<{ value: SystemDataScope; label: string; description: string }> = [
  { value: "all", label: "当前租户全部数据", description: "可查看当前租户内全部组织和空间数据" },
  { value: "organization", label: "所属组织", description: "仅所属组织及其业务范围" },
  { value: "store", label: "当前空间", description: "仅当前经营空间的数据" },
  { value: "own", label: "仅本人", description: "仅本人创建或被分配的数据" }
];

const SCOPE_LABELS: Record<string, string> = {
  operator: "租户级",
  car_shop: "业务组织",
  store: "经营空间",
  station: "履约点"
};

interface WorkspaceAccessRow {
  workspaceId: string;
  enabled: boolean;
  roleId?: string;
  dataScope: SystemDataScope;
  locationScope: { mode: "all" | "selected"; locationIds: string[] };
  existed: boolean;
}

type TenantOperationsAccountForm = Omit<SaveSystemUserRequest, "roleIds"> & {
  roleId?: string;
};

function useTenantAccessData() {
  const organizations = useQuery({ queryKey: ["tenant-access", "organizations"], queryFn: api.organizations });
  const users = useQuery({ queryKey: ["tenant-access", "users"], queryFn: api.users });
  const roles = useQuery({ queryKey: ["tenant-access", "roles"], queryFn: api.roles });
  const workspaces = useQuery({ queryKey: ["tenant-access", "workspaces"], queryFn: api.workspaces });
  const members = useQuery({
    queryKey: ["tenant-access", "members", (workspaces.data ?? []).map((item) => item.id).join(",")],
    enabled: Boolean(workspaces.data),
    queryFn: async () => {
      const rows = await Promise.all((workspaces.data ?? []).map(async (workspace) => ({
        workspaceId: workspace.id,
        members: await api.workspaceMembers(workspace.id)
      })));
      return rows;
    }
  });
  const fulfillmentLocations = useQuery({
    queryKey: ["tenant-access", "fulfillment-locations", (workspaces.data ?? []).map((item) => item.id).join(",")],
    enabled: Boolean(workspaces.data),
    queryFn: async () => Promise.all((workspaces.data ?? []).map(async (workspace) => ({
      workspaceId: workspace.id,
      locations: await api.workspaceFulfillmentLocations(workspace.id)
    })))
  });
  return { organizations, users, roles, workspaces, members, fulfillmentLocations };
}

function dataScopeTag(scope: SystemDataScope, translate: (value: string) => string) {
  return <Tag color={scope === "all" ? "purple" : scope === "own" ? "default" : "blue"}>{translate(DATA_SCOPE_OPTIONS.find((item) => item.value === scope)?.label ?? scope)}</Tag>;
}

export function TenantOperationsAccountPage() {
  const { message, modal } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { organizations, users, roles, workspaces, members, fulfillmentLocations } = useTenantAccessData();
  const accountFilter = useListFilter(users.data, { fields: row => [row.account, row.displayName, row.phone, row.organizationName], status: row => row.isActive ? "active" : "disabled" });
  const [form] = Form.useForm<TenantOperationsAccountForm>();
  const [editing, setEditing] = useState<SystemUserRow>();
  const [accountView, setAccountView] = useState("directory");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accessRows, setAccessRows] = useState<WorkspaceAccessRow[]>([]);

  const activeRoles = (roles.data ?? []).filter((role) => role.isActive);
  const defaultRoleId = activeRoles.find((role) => role.scope === RoleScope.Store && !role.fixedAllPermissions)?.id
    ?? activeRoles.find((role) => !role.fixedAllPermissions)?.id
    ?? activeRoles[0]?.id;
  const roleMap = useMemo(() => new Map((roles.data ?? []).map((role) => [role.id, role])), [roles.data]);
  const workspaceMap = useMemo(() => new Map((workspaces.data ?? []).map((workspace) => [workspace.id, workspace])), [workspaces.data]);
  const memberRows = useMemo(() => (members.data ?? []).flatMap((group) => group.members), [members.data]);
  const locationsByWorkspace = useMemo(() => new Map((fulfillmentLocations.data ?? []).map((group) => [group.workspaceId, group.locations])), [fulfillmentLocations.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tenant-access", "users"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-access", "members"] })
    ]);
  };

  const save = useMutation({
    mutationFn: async (values: SaveSystemUserRequest) => {
      const payload: SaveSystemUserAccessRequest = {
        ...values,
        id: editing?.id,
        workspaceAccesses: accessRows
          .filter((row) => workspaceMap.get(row.workspaceId)?.status === "active" && (row.enabled || row.existed))
          .map((row) => ({
            workspaceId: row.workspaceId,
            roleId: row.roleId,
            dataScope: row.dataScope,
            locationScope: row.locationScope,
            isActive: row.enabled
          }))
      };
      return api.saveUserWithWorkspaceAccess(payload);
    },
    onSuccess: async (user) => {
      await refresh();
      setDrawerOpen(false);
      form.resetFields();
      if (user.temporaryPassword) {
        modal.success({
          title: t("运营账号已创建"),
          content: <><Typography.Paragraph>{t("请将以下临时密码安全交给账号持有人，首次登录必须修改。")}</Typography.Paragraph><Typography.Text code>{user.temporaryPassword}</Typography.Text><CopyButton value={user.temporaryPassword} /></>
        });
      } else {
        message.success(t("运营账号与空间权限已保存"));
      }
    },
    onError: () => message.error(t("保存失败，请检查基础角色、空间角色和账号唯一性"))
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.setUserStatus(id, isActive),
    onSuccess: async () => { await refresh(); message.success(t("账号状态已更新")); },
    onError: () => message.error(t("账号状态更新失败"))
  });

  const resetPassword = useMutation({
    mutationFn: api.resetUserPassword,
    onSuccess: (result) => modal.success({ title: t("密码已重置"), content: <><Typography.Paragraph>{t(result.message)}</Typography.Paragraph><Typography.Text code>{result.temporaryPassword}</Typography.Text><CopyButton value={result.temporaryPassword} /></> }),
    onError: () => message.error(t("密码重置失败"))
  });

  function openEditor(user?: SystemUserRow) {
    const assignments = (workspaces.data ?? []).map((workspace) => {
      const member = memberRows.find((item) => item.workspaceId === workspace.id && item.userId === user?.id);
      return {
        workspaceId: workspace.id,
        enabled: member?.isActive ?? false,
        roleId: member?.roleId ?? user?.roleIds[0] ?? defaultRoleId,
        dataScope: member?.dataScope ?? roleMap.get(member?.roleId ?? user?.roleIds[0] ?? "")?.dataScope ?? "store",
        locationScope: member?.locationScope ?? { mode: "all", locationIds: [] },
        existed: Boolean(member)
      } satisfies WorkspaceAccessRow;
    });
    setEditing(user);
    setAccessRows(assignments);
    form.setFieldsValue(user ? {
      id: user.id,
      account: user.account,
      displayName: user.displayName,
      phone: user.phone,
      organizationId: user.organizationId,
      roleId: user.roleIds[0],
      isPlatformAdmin: user.isPlatformAdmin,
      isActive: user.isActive
    } : { account: "", displayName: "", roleId: defaultRoleId, isPlatformAdmin: false, isActive: true });
    setDrawerOpen(true);
  }

  function updateAccess(workspaceId: string, patch: Partial<WorkspaceAccessRow>) {
    setAccessRows((rows) => rows.map((row) => row.workspaceId === workspaceId ? { ...row, ...patch } : row));
  }

  const loading = organizations.isLoading || users.isLoading || roles.isLoading || workspaces.isLoading || members.isLoading || fulfillmentLocations.isLoading;
  const error = organizations.error ?? users.error ?? roles.error ?? workspaces.error ?? members.error ?? fulfillmentLocations.error;

  return <>
    <PageHeader title={t("运营账号管理")} summary={<InsightMetrics items={[{label:t("账号"),value:accountFilter.rows.length},{label:t("已启用"),value:accountFilter.rows.filter(row=>row.isActive).length}]} />} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{t("新增运营账号")}</Button>} note={{ title: t("权限分为两层"), description: t("角色决定可以执行哪些操作；数据范围决定在获准操作内可以看哪些数据。经营空间访问权单独授予，不能只靠隐藏菜单代替。") }} />
    <QueryState loading={loading} error={error}>
      <div className={accessStyles.roleTools}><ListFilterBar><ListFilters filter={accountFilter} placeholder="账号、姓名或手机号" options={[{value:"active",label:"已启用"},{value:"disabled",label:"已停用"}]}/></ListFilterBar><Segmented value={accountView} onChange={value=>setAccountView(String(value))} options={[{value:"directory",label:t("人员目录")},{value:"table",label:t("列表")}]}/></div>
      {accountView === "directory" ? <><div className={accessStyles.directory}>{accountFilter.rows.slice((accountFilter.pagination.current-1)*accountFilter.pagination.pageSize,accountFilter.pagination.current*accountFilter.pagination.pageSize).map(record => {
        const accessible=memberRows.filter(member=>member.userId===record.id&&member.isActive);
        return <ArcCard key={record.id} className={accessStyles.person} title={record.displayName} description={record.account}
          avatar={<span className={accessStyles.personAvatar}>{record.displayName.trim().slice(0,1)}</span>}
          meta={record.organizationName||t("未分配")} status={t(record.isActive?"已启用":"已停用")}
          action={<ArcButton variant="secondary" size="sm" onClick={()=>openEditor(record)}>{t("编辑授权")}</ArcButton>}>
          <dl className={accessStyles.personFacts}><div><dt>{t("租户基础角色")}</dt><dd>{record.roleNames.join("、")||t("未分配")}</dd></div><div><dt>{t("可访问空间")}</dt><dd><AnimatedNumber value={accessible.length}/></dd></div></dl>
          <p className={accessStyles.permissionSummary}>{accessible.map(member=>workspaceMap.get(member.workspaceId)?.name).filter(Boolean).join(" · ")||t("未授权")}</p>
        </ArcCard>;
      })}</div>{!accountFilter.rows.length && <Empty description={t("没有匹配的账号")}/>}<Pagination {...accountFilter.pagination} total={accountFilter.rows.length} showSizeChanger hideOnSinglePage/></> : <ListSection>


        <Table<SystemUserRow> toolbarNote={false} rowKey="id" onRefresh={() => users.refetch()} loading={users.isLoading} refreshing={users.isFetching} dataSource={accountFilter.rows} pagination={accountFilter.pagination} scroll={{ x: 1120 }} columns={[
          { title: t("账号"), width: 190, render: (_, record) => <DataTableText primary={record.displayName} secondary={record.account}/> },
          { title: t("手机"), dataIndex: "phone", width: 140, render: (value) => value || "-" },
          { title: t("归属组织"), dataIndex: "organizationName", width: 160, render: (value) => value || t("未分配") },
          { title: t("租户基础角色"), dataIndex: "roleNames", width: 180, render: (values: string[]) => values.join("、") || t("未分配") },
          { title: t("可访问空间"), width: 250, render: (_, record) => {
            const accessible = memberRows.filter((member) => member.userId === record.id && member.isActive);
            return accessible.length ? <Space size={[4, 4]} wrap>{accessible.map((member) => <Tag key={member.workspaceId}>{workspaceMap.get(member.workspaceId)?.name ?? member.workspaceId}</Tag>)}</Space> : <Typography.Text type="secondary">{t("未授权")}</Typography.Text>;
          } },
          { title: t("状态"), width: 100, render: (_, record) => <Switch checked={record.isActive} disabled={record.id === currentUserId} loading={toggleStatus.isPending} onChange={(isActive) => toggleStatus.mutate({ id: record.id, isActive })} /> },
          { title: t("操作"), fixed: "right", render: (_, record) => <DataTableRowActions primary={{ id: "edit", label: t("编辑授权"), icon: Pencil, onSelect: () => openEditor(record) }} details={() => openEditor(record)} detailLabel={t("编辑授权")} menuLabel={`${record.account} · ${t("更多操作")}`} actions={[{ id: "reset", label: t("重置密码"), icon: KeyRound, onSelect: () => modal.confirm({ title: `${t("重置")} ${record.account} ${t("的密码？")}`, content: t("重置后原登录会话失效，并生成一次性临时密码。"), onOk: () => resetPassword.mutateAsync(record.id) }) }]} /> }
        ]} />
      </ListSection>}
    </QueryState>

    <Drawer title={editing ? t("编辑运营账号") : t("新增运营账号")} open={drawerOpen} size="large" destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<SaveButton label={t("保存账号与空间权限")} form={form} pending={save.isPending} onSave={(values) => { const { roleId, ...rest } = values; return save.mutateAsync({ ...rest, roleIds: roleId ? [roleId] : [] }); }} />}>
      <Form<TenantOperationsAccountForm> form={form} layout="vertical" onFinish={(values) => {
        const { roleId, ...rest } = values;
        save.mutate({ ...rest, roleIds: roleId ? [roleId] : [] });
      }}>
        <SettingsWorkspace sections={[
          { key: "profile", label: t("账号资料"), content: <FormSection title={t("账号资料")}>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="displayName" label={t("姓名")} rules={[{ required: true, message: t("请输入姓名") }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="account" label={t("登录账号")} rules={[{ required: true, message: t("请输入登录账号") }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
          <Col span={12}><Form.Item name="phone" label={t("手机号")}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="organizationId" label={t("归属组织")}><Select allowClear options={(organizations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
          <Col span={12}><Form.Item name="roleId" label={t("租户基础角色")} rules={[{ required: true, message: t("请选择基础角色") }]}><Select options={activeRoles.map((role) => ({ value: role.id, label: role.name }))} /></Form.Item></Col>
          <Col span={6}><Form.Item name="isActive" label={t("账号启用")} valuePropName="checked"><Switch /></Form.Item></Col>
          <Col span={6}><Form.Item name="isPlatformAdmin" label={t("租户管理员")} valuePropName="checked"><Switch disabled={editing?.id === currentUserId} /></Form.Item></Col>
        </Row>
          </FormSection> },
          { key: "access", label: t("经营空间授权"), content: <FormSection title={t("经营空间授权")}
            description={t("启用空间后必须指定该空间的角色；数据范围可覆盖角色默认值。关闭空间会使该账号无法进入该空间。")}>
            {editing?.id === currentUserId && <p className={accessStyles.permissionSummary}>{t("当前登录账号的空间授权不可在此修改。")}</p>}
            <Accordion defaultOpen={0} items={accessRows.map(row => {
              const workspace = workspaceMap.get(row.workspaceId);
              const locked = editing?.id === currentUserId || workspace?.status !== "active";
              const disabled = !row.enabled || locked;
              const locations = (locationsByWorkspace.get(row.workspaceId) ?? []).filter(location => location.status === "enabled");
              return {
                key: row.workspaceId,
                title: <DataTableText primary={workspace?.name ?? row.workspaceId} secondary={workspace?.code} />,
                extra: <Space size={8}><span className={accessStyles.permissionSummary}>{t("允许访问")}</span><Switch aria-label={`${workspace?.name ?? row.workspaceId} · ${t("允许访问")}`} checked={row.enabled} disabled={locked} onChange={enabled => updateAccess(row.workspaceId, { enabled })} /></Space>,
                content: <div className={accessStyles.workspaceFields}>
                  <Form.Item label={t("空间角色（操作权限）")} htmlFor={`workspace-role-${row.workspaceId}`}>
                    <Select id={`workspace-role-${row.workspaceId}`} disabled={disabled} value={row.roleId}
                      options={activeRoles.map(role => ({ value: role.id, label: `${role.name} · ${t(SCOPE_LABELS[role.scope] ?? role.scope)}` }))}
                      onChange={roleId => updateAccess(row.workspaceId, { roleId, dataScope: roleMap.get(roleId)?.dataScope ?? row.dataScope })} />
                  </Form.Item>
                  <Form.Item label={t("数据范围")} htmlFor={`workspace-scope-${row.workspaceId}`}>
                    <Select id={`workspace-scope-${row.workspaceId}`} disabled={disabled} value={row.dataScope}
                      options={DATA_SCOPE_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))}
                      onChange={dataScope => updateAccess(row.workspaceId, { dataScope })} />
                  </Form.Item>
                  <Form.Item label={t("员工履约地点范围")} htmlFor={`workspace-locations-${row.workspaceId}`}>
                    <Select id={`workspace-locations-${row.workspaceId}`} disabled={disabled} value={row.locationScope.mode}
                      options={[{ value: "all", label: t("全部履约地点") }, { value: "selected", label: t("仅指定地点") }]}
                      onChange={(mode: "all" | "selected") => updateAccess(row.workspaceId, { locationScope: { mode, locationIds: mode === "all" ? [] : row.locationScope.locationIds } })} />
                  </Form.Item>
                  {row.locationScope.mode === "selected" && <Form.Item label={t("选择至少一个地点")} htmlFor={`workspace-location-ids-${row.workspaceId}`}>
                    <Select id={`workspace-location-ids-${row.workspaceId}`} mode="multiple" disabled={disabled} value={row.locationScope.locationIds}
                      options={locations.map(location => ({ value: location.id, label: `${location.name} · ${location.code}` }))}
                      onChange={locationIds => updateAccess(row.workspaceId, { locationScope: { mode: "selected", locationIds } })} />
                  </Form.Item>}
                </div>,
              };
            })} />
            {!accessRows.length && <Empty description={t("暂无经营空间")} />}
          </FormSection> },
        ]} />
      </Form>
    </Drawer>
  </>;
}

export function TenantRolePermissionPage() {
  const { message, modal } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ["tenant-access", "roles"], queryFn: api.roles });
  const permissions = useQuery({ queryKey: ["tenant-access", "permissions"], queryFn: api.permissionTree });
  const roleFilter = useListFilter(roles.data, { fields: row => [row.name, row.code], status: row => row.isActive ? "active" : "disabled" });
  const [form] = Form.useForm<SaveSystemRoleRequest>();
  const [editing, setEditing] = useState<SystemRoleRow>();
  const [open, setOpen] = useState(false);
  const [roleView, setRoleView] = useState("matrix");

  const save = useMutation({
    mutationFn: api.saveRole,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["tenant-access", "roles"] }); setOpen(false); message.success(t("角色权限已保存")); },
    onError: () => message.error(t("角色保存失败，请检查编码和权限"))
  });
  const remove = useMutation({
    mutationFn: api.deleteRole,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["tenant-access", "roles"] }); message.success(t("角色已删除")); },
    onError: () => message.error(t("角色仍被账号或空间使用，不能删除"))
  });

  function openEditor(role?: SystemRoleRow) {
    setEditing(role);
    form.setFieldsValue(role ? {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      scope: role.scope,
      enabledBusinessScopes: role.enabledBusinessScopes,
      permissions: [...new Set([...role.permissions.filter((item) => item !== "*"), ...role.buttonPermissions.filter((item) => item !== "*")])],
      dataScope: role.dataScope,
      isActive: role.isActive
    } : { code: "", name: "", scope: RoleScope.Store, enabledBusinessScopes: ["rental"], permissions: [], dataScope: "store", isActive: true });
    setOpen(true);
  }

  return <>
    <PageHeader title={t("角色权限管理")} summary={<InsightMetrics items={[{label:t("角色"),value:roleFilter.rows.length},{label:t("权限模块"),value:permissions.data?.length}]} />} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{t("新增角色")}</Button>} />
    <QueryState loading={roles.isLoading || permissions.isLoading} error={roles.error ?? permissions.error}>
      <Alert type="warning" showIcon title={t("数据权限")} description={t("决定操作获准后可访问的数据边界。当前空间隔离已强制生效；组织/本人范围仍需各业务模块逐项接入。")} style={{ marginBottom: "var(--space-4)" }} />
      <div className={accessStyles.roleTools}><ListFilterBar><ListFilters filter={roleFilter} placeholder="角色名称或编码" options={[{value:"active",label:"已启用"},{value:"disabled",label:"已停用"}]}/></ListFilterBar><Segmented value={roleView} onChange={value=>setRoleView(String(value))} options={[{value:"matrix",label:t("权限对照")},{value:"list",label:t("角色列表")}]}/></div>
      {roleView === "matrix" ? <PermissionMatrix roles={roleFilter.rows} modules={permissions.data??[]} onEdit={openEditor}/> : <ListSection>


        <Table<SystemRoleRow> toolbarNote={false} rowKey="id" onRefresh={() => roles.refetch()} loading={roles.isLoading} refreshing={roles.isFetching} dataSource={roleFilter.rows} pagination={roleFilter.pagination} scroll={{ x: 980 }} columns={[
          { title: t("角色"), width: 220, render: (_, record) => <DataTableText primary={record.name} secondary={record.code}/> },
          { title: t("适用层级"), dataIndex: "scope", width: 130, render: (value) => <Tag>{t(SCOPE_LABELS[value] ?? value)}</Tag> },
          { title: t("默认数据范围"), dataIndex: "dataScope", width: 200, render: (value: SystemDataScope) => dataScopeTag(value, t) },
          { title: t("操作权限"), width: 130, render: (_, record) => record.fixedAllPermissions ? <Tag color="purple">{t("全部权限")}</Tag> : `${new Set([...record.permissions, ...record.buttonPermissions]).size} ${t("项")}` },
          { title: t("状态"), dataIndex: "isActive", width: 100, render: (value) => <Tag color={value ? "success" : "default"}>{t(value ? "启用" : "停用")}</Tag> },
          { title: t("操作"), fixed: "right", width: 170, render: (_, record) => record.fixedAllPermissions ? <Tag>{t("系统预设")}</Tag> : <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openEditor(record)}>{t("编辑")}</Button><ConfirmAction label={t("删除")} prompt={<>{`${t("删除角色")} ${record.name}？`} {t("已分配给账号或空间的角色不能删除。")}</>} onConfirm={() => remove.mutateAsync(record.id)} /></Space> }
        ]} />
      </ListSection>}
    </QueryState>

    <Drawer title={editing ? t("编辑角色") : t("新增角色")} open={open} size="large" destroyOnHidden onClose={() => setOpen(false)} extra={<SaveButton label={t("保存角色")} form={form} pending={save.isPending} onSave={(values) => save.mutateAsync({ ...values, id: editing?.id, buttonPermissions: [] })} />}>
      <Form<SaveSystemRoleRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, id: editing?.id, buttonPermissions: [] })}>
        <SettingsWorkspace sections={[
          { key: "profile", label: t("基本资料"), content: <FormSection title={t("基本资料")}>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="name" label={t("角色名称")} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="code" label={t("角色编码")} rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
          <Col span={12}><Form.Item name="scope" label={t("适用层级")} rules={[{ required: true }]}><Select options={Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col>
          <Col span={24}><Form.Item name="description" label={t("角色说明")}><Input.TextArea rows={2} /></Form.Item></Col>
          <Col span={24}><Form.Item name="isActive" label={t("启用角色")} valuePropName="checked"><Switch /></Form.Item></Col>
        </Row>
          </FormSection> },
          { key: "permissions", label: t("操作权限"), content: <FormSection title={t("操作权限")}
            description={t("按模块勾选页面访问和具体操作。未勾选即拒绝，前端隐藏不替代后端鉴权。")}>
        <Form.Item name="permissions"><PermissionEditor modules={permissions.data ?? []} disabled={save.isPending} /></Form.Item>
          </FormSection> },
          { key: "scope", label: t("数据范围"), content: <FormSection title={t("数据范围")}
            description={t("决定操作获准后可访问的数据边界。当前空间隔离已强制生效；组织/本人范围仍需各业务模块逐项接入。")}>
            <Form.Item name="dataScope" label={t("默认数据范围")} rules={[{ required: true }]}><Select options={DATA_SCOPE_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))} /></Form.Item>
          </FormSection> },
        ]} />
        <Form.Item name="enabledBusinessScopes" hidden><Select mode="multiple" /></Form.Item>
      </Form>
    </Drawer>
  </>;
}

import { EditOutlined, KeyOutlined, PlusOutlined } from "@ant-design/icons";
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
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography
} from "antd";
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
  const [form] = Form.useForm<TenantOperationsAccountForm>();
  const [editing, setEditing] = useState<SystemUserRow>();
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
          content: <><Typography.Paragraph>{t("请将以下临时密码安全交给账号持有人，首次登录必须修改。")}</Typography.Paragraph><Typography.Text code copyable>{user.temporaryPassword}</Typography.Text></>
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
    onSuccess: (result) => modal.success({ title: t("密码已重置"), content: <><Typography.Paragraph>{t(result.message)}</Typography.Paragraph><Typography.Text code copyable>{result.temporaryPassword}</Typography.Text></> }),
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
    <PageHeader title={t("运营账号管理")} description={t("账号属于租户；可访问空间、空间角色和数据范围按每个经营空间分别授权。")} note={{ title: t("权限分为两层"), description: t("角色决定可以执行哪些操作；数据范围决定在获准操作内可以看哪些数据。经营空间访问权单独授予，不能只靠隐藏菜单代替。") }} />
    <QueryState loading={loading} error={error}>
      <Card>
        <div className="table-toolbar"><Typography.Text type="secondary">{t("共")} {users.data?.length ?? 0} {t("个运营账号")}</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{t("新增运营账号")}</Button></div>
        <Table<SystemUserRow> rowKey="id" dataSource={users.data ?? []} scroll={{ x: 1120 }} columns={[
          { title: t("账号"), width: 190, render: (_, record) => <><b>{record.displayName}</b><br /><Typography.Text type="secondary">{record.account}</Typography.Text></> },
          { title: t("手机"), dataIndex: "phone", width: 140, render: (value) => value || "-" },
          { title: t("归属组织"), dataIndex: "organizationName", width: 160, render: (value) => value || t("未分配") },
          { title: t("租户基础角色"), dataIndex: "roleNames", width: 180, render: (values: string[]) => values.join("、") || t("未分配") },
          { title: t("可访问空间"), width: 250, render: (_, record) => {
            const accessible = memberRows.filter((member) => member.userId === record.id && member.isActive);
            return accessible.length ? <Space size={[4, 4]} wrap>{accessible.map((member) => <Tag key={member.workspaceId}>{workspaceMap.get(member.workspaceId)?.name ?? member.workspaceId}</Tag>)}</Space> : <Typography.Text type="secondary">{t("未授权")}</Typography.Text>;
          } },
          { title: t("状态"), width: 100, render: (_, record) => <Switch checked={record.isActive} disabled={record.id === currentUserId} loading={toggleStatus.isPending} onChange={(isActive) => toggleStatus.mutate({ id: record.id, isActive })} /> },
          { title: t("操作"), fixed: "right", width: 180, render: (_, record) => <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openEditor(record)}>{t("编辑授权")}</Button><Button type="link" icon={<KeyOutlined />} onClick={() => modal.confirm({ title: `${t("重置")} ${record.account} ${t("的密码？")}`, content: t("重置后原登录会话失效，并生成一次性临时密码。"), onOk: () => resetPassword.mutateAsync(record.id) })}>{t("重置密码")}</Button></Space> }
        ]} />
      </Card>
    </QueryState>

    <Drawer title={editing ? t("编辑运营账号") : t("新增运营账号")} open={drawerOpen} size="large" destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>{t("保存账号与空间权限")}</Button>}>
      <Form<TenantOperationsAccountForm> form={form} layout="vertical" onFinish={(values) => {
        const { roleId, ...rest } = values;
        save.mutate({ ...rest, roleIds: roleId ? [roleId] : [] });
      }}>
        <Typography.Title level={5}>{t("账号资料")}</Typography.Title>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="displayName" label={t("姓名")} rules={[{ required: true, message: t("请输入姓名") }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="account" label={t("登录账号")} rules={[{ required: true, message: t("请输入登录账号") }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
          <Col span={12}><Form.Item name="phone" label={t("手机号")}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="organizationId" label={t("归属组织")}><Select allowClear options={(organizations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
          <Col span={12}><Form.Item name="roleId" label={t("租户基础角色")} rules={[{ required: true, message: t("请选择基础角色") }]}><Select options={activeRoles.map((role) => ({ value: role.id, label: role.name }))} /></Form.Item></Col>
          <Col span={6}><Form.Item name="isActive" label={t("账号启用")} valuePropName="checked"><Switch /></Form.Item></Col>
          <Col span={6}><Form.Item name="isPlatformAdmin" label={t("租户管理员")} valuePropName="checked"><Switch disabled={editing?.id === currentUserId} /></Form.Item></Col>
        </Row>
        <Typography.Title level={5} style={{ marginTop: 12 }}>{t("经营空间授权")}</Typography.Title>
        <Typography.Paragraph type="secondary">{t("启用空间后必须指定该空间的角色；数据范围可覆盖角色默认值。关闭空间会使该账号无法进入该空间。")}</Typography.Paragraph>
        <Table<WorkspaceAccessRow> rowKey="workspaceId" pagination={false} dataSource={accessRows} scroll={{ x: 1420 }} columns={[
          { title: t("允许访问"), width: 95, render: (_, row) => <Switch checked={row.enabled} disabled={editing?.id === currentUserId || workspaceMap.get(row.workspaceId)?.status !== "active"} onChange={(enabled) => updateAccess(row.workspaceId, { enabled })} /> },
          { title: t("经营空间"), width: 200, render: (_, row) => { const workspace = workspaceMap.get(row.workspaceId); return <><b>{workspace?.name}</b><br /><Typography.Text type="secondary">{workspace?.code}</Typography.Text></>; } },
          { title: t("空间角色（操作权限）"), render: (_, row) => <Select style={{ width: "100%" }} disabled={!row.enabled || editing?.id === currentUserId || workspaceMap.get(row.workspaceId)?.status !== "active"} value={row.roleId} options={activeRoles.map((role) => ({ value: role.id, label: `${role.name} · ${t(SCOPE_LABELS[role.scope] ?? role.scope)}` }))} onChange={(roleId) => updateAccess(row.workspaceId, { roleId, dataScope: roleMap.get(roleId)?.dataScope ?? row.dataScope })} /> },
          { title: t("数据范围"), width: 210, render: (_, row) => <Select style={{ width: "100%" }} disabled={!row.enabled || editing?.id === currentUserId || workspaceMap.get(row.workspaceId)?.status !== "active"} value={row.dataScope} options={DATA_SCOPE_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))} onChange={(dataScope) => updateAccess(row.workspaceId, { dataScope })} /> },
          { title: t("员工履约地点范围"), width: 330, render: (_, row) => {
            const disabled = !row.enabled || editing?.id === currentUserId || workspaceMap.get(row.workspaceId)?.status !== "active";
            const locations = (locationsByWorkspace.get(row.workspaceId) ?? []).filter((location) => location.status === "enabled");
            return <Space orientation="vertical" size={6} style={{ width: "100%" }}>
              <Select style={{ width: "100%" }} disabled={disabled} value={row.locationScope.mode} options={[
                { value: "all", label: t("全部履约地点") },
                { value: "selected", label: t("仅指定地点") }
              ]} onChange={(mode: "all" | "selected") => updateAccess(row.workspaceId, { locationScope: { mode, locationIds: mode === "all" ? [] : row.locationScope.locationIds } })} />
              {row.locationScope.mode === "selected" && <Select mode="multiple" style={{ width: "100%" }} disabled={disabled} placeholder={t("选择至少一个地点")} value={row.locationScope.locationIds} options={locations.map((location) => ({ value: location.id, label: `${location.name} · ${location.code}` }))} onChange={(locationIds) => updateAccess(row.workspaceId, { locationScope: { mode: "selected", locationIds } })} />}
            </Space>;
          } }
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
  const [form] = Form.useForm<SaveSystemRoleRequest>();
  const [editing, setEditing] = useState<SystemRoleRow>();
  const [open, setOpen] = useState(false);

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
    <PageHeader title={t("角色权限管理")} description={t("RBAC 角色统一管理操作权限；数据范围单独设置，并可在账号的具体经营空间授权中覆盖。")} />
    <QueryState loading={roles.isLoading || permissions.isLoading} error={roles.error ?? permissions.error}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}><Alert type="info" showIcon title={t("操作权限")} description={t("决定账号能进入哪些页面、查看哪些模块，以及可以执行新增、编辑、审核、发布等动作。")} /></Col>
        <Col xs={24} lg={12}><Alert type="warning" showIcon title={t("数据权限")} description={t("决定操作获准后可访问的数据边界。当前空间隔离已强制生效；组织/本人范围仍需各业务模块逐项接入。")} /></Col>
      </Row>
      <Card>
        <div className="table-toolbar"><Typography.Text type="secondary">{t("角色可复用于多个运营账号和经营空间")}</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{t("新增角色")}</Button></div>
        <Table<SystemRoleRow> rowKey="id" dataSource={roles.data ?? []} scroll={{ x: 980 }} columns={[
          { title: t("角色"), width: 220, render: (_, record) => <><b>{record.name}</b><br /><Typography.Text type="secondary">{record.code}</Typography.Text></> },
          { title: t("适用层级"), dataIndex: "scope", width: 130, render: (value) => <Tag>{t(SCOPE_LABELS[value] ?? value)}</Tag> },
          { title: t("默认数据范围"), dataIndex: "dataScope", width: 200, render: (value: SystemDataScope) => dataScopeTag(value, t) },
          { title: t("操作权限"), width: 130, render: (_, record) => record.fixedAllPermissions ? <Tag color="purple">{t("全部权限")}</Tag> : `${new Set([...record.permissions, ...record.buttonPermissions]).size} ${t("项")}` },
          { title: t("状态"), dataIndex: "isActive", width: 100, render: (value) => <Tag color={value ? "success" : "default"}>{t(value ? "启用" : "停用")}</Tag> },
          { title: t("操作"), fixed: "right", width: 170, render: (_, record) => record.fixedAllPermissions ? <Tag>{t("系统预设")}</Tag> : <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openEditor(record)}>{t("编辑")}</Button><Button danger type="link" onClick={() => modal.confirm({ title: `${t("删除角色")} ${record.name}？`, content: t("已分配给账号或空间的角色不能删除。"), okButtonProps: { danger: true }, onOk: () => remove.mutateAsync(record.id) })}>{t("删除")}</Button></Space> }
        ]} />
      </Card>
    </QueryState>

    <Drawer title={editing ? t("编辑角色") : t("新增角色")} open={open} size="large" destroyOnHidden onClose={() => setOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>{t("保存角色")}</Button>}>
      <Form<SaveSystemRoleRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, id: editing?.id, buttonPermissions: [] })}>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="name" label={t("角色名称")} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="code" label={t("角色编码")} rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
          <Col span={12}><Form.Item name="scope" label={t("适用层级")} rules={[{ required: true }]}><Select options={Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col>
          <Col span={12}><Form.Item name="dataScope" label={t("默认数据范围")} rules={[{ required: true }]}><Select options={DATA_SCOPE_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))} /></Form.Item></Col>
          <Col span={24}><Form.Item name="description" label={t("角色说明")}><Input.TextArea rows={2} /></Form.Item></Col>
          <Col span={24}><Form.Item name="isActive" label={t("启用角色")} valuePropName="checked"><Switch /></Form.Item></Col>
        </Row>
        <Typography.Title level={5}>{t("操作权限")}</Typography.Title>
        <Typography.Paragraph type="secondary">{t("按模块勾选页面访问和具体操作。未勾选即拒绝，前端隐藏不替代后端鉴权。")}</Typography.Paragraph>
        <Form.Item name="permissions">
          <Checkbox.Group style={{ width: "100%" }}>
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {(permissions.data ?? []).map((module: PermissionModule) => <Card key={module.code} size="small" title={t(module.name)}>
                <Row gutter={[12, 10]}>{module.children.map((permission) => <Col key={permission.code} xs={24} md={12}><Checkbox value={permission.code}>{t(permission.name)}</Checkbox>{permission.description && <Typography.Text type="secondary" style={{ display: "block", paddingLeft: 24 }}>{t(permission.description)}</Typography.Text>}</Col>)}</Row>
              </Card>)}
            </Space>
          </Checkbox.Group>
        </Form.Item>
        <Form.Item name="enabledBusinessScopes" hidden><Select mode="multiple" /></Form.Item>
      </Form>
    </Drawer>
  </>;
}

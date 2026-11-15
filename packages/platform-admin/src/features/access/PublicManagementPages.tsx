/** 公共人员/角色页面使用原目录和保存接口；页面权限不替代服务端，Core使用权另外分配。 */
import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { RoleScope, type PermissionModule, type SaveSystemRoleRequest, type SaveSystemUserRequest,
  type SystemRoleRow, type SystemUserRow } from "@rental-os/platform-contracts";
import { Alert, Button, ConfirmAction, CopyButton, DataTableStatus, DataTableText, Form, FormSection, Input,
  ListFilters, ListSection, Result, SaveButton, Select, Switch, Table, useListFilter } from "../../components/ui";
import { PageHeading, QueryState, SettingsWorkspace, useServerFormSync } from "../../shell";
import { UnsavedChangesGuard } from "../../components/UnsavedChangesGuard";
import { useAdminSession } from "../../runtime";
import { usePlatformApplication } from "../../application-context";
import { canManagePublicResource } from "../../application-access";
import { formSnapshotFingerprint, notifyFormSaved } from "../../forms";
import { useLocale } from "../../app/locale";
import { PermissionEditor } from "./PermissionMatrix";
import { isFixedRole } from "./permission-matrix-model";

const base = { users: "/settings/users", roles: "/settings/roles" } as const;
type Kind = keyof typeof base;
function useDirectory<T>(kind: string, path = `/platform/${kind}`) {
  const { session } = usePlatformApplication();
  return useQuery({ queryKey: ["public-management", session.currentSessionEpoch(), kind],
    queryFn: ({ signal }) => session.runtime.request<T>(path, { signal }), meta: { liveRefresh: false } });
}

function ManagementGate({ kind, children }: { kind: Kind; children: ReactNode }) {
  const { user, sessionVerified } = useAdminSession();
  return sessionVerified && canManagePublicResource(user, "tenant", kind === "users" ? "system:user:manage" : "system:role:manage")
    ? children : <Result status="403" title="403" />;
}

function Directory({ kind }: { kind: Kind }) {
  const { brandName } = usePlatformApplication(), { locale } = useLocale(), en = locale === "en-US", navigate = useNavigate();
  const query = useDirectory<Array<SystemUserRow | SystemRoleRow>>(kind);
  const filter = useListFilter(query.data, { fields: row => "account" in row ? [row.account, row.displayName] : [row.code, row.name],
    status: row => row.isActive ? "active" : "disabled" });
  const title = kind === "users" ? en ? "Members" : "人员管理" : en ? "Roles" : "角色权限";
  return <><PageHeading title={title} brandName={brandName} extra={<Button onClick={() => navigate(`${base[kind]}/new`)}>
    {en ? "Create" : "新增"}</Button>} />
    <QueryState loading={query.isPending} error={query.error} onRetry={query.refetch}>
      <ListSection controls={<ListFilters filter={filter} placeholder={en ? "Search name or code" : "搜索姓名或编码"}
        options={[{ value: "active", label: en ? "Enabled" : "已启用" }, { value: "disabled", label: en ? "Disabled" : "已停用" }]} />}>
        <Table<SystemUserRow | SystemRoleRow> rowKey="id" dataSource={filter.rows} pagination={filter.pagination}
          refreshing={query.isFetching} onRefresh={query.refetch} columns={[
            { title: en ? "Name" : "名称", key: "name", render: (_, row) => <DataTableText
              primary={"account" in row ? row.displayName : row.name} secondary={"account" in row ? row.account : row.code} /> },
            { title: en ? "Access" : "授权", key: "access", render: (_, row) => "roleNames" in row ? row.roleNames.join("、")
              : isFixedRole(row) ? en ? "Fixed administrator" : "固定管理员" : `${row.permissions.length} ${en ? "permissions" : "项权限"}` },
            { title: en ? "Status" : "状态", key: "status", render: (_, row) => <DataTableStatus tone={row.isActive ? "success" : "neutral"}>
              {row.isActive ? en ? "Enabled" : "已启用" : en ? "Disabled" : "已停用"}</DataTableStatus> },
            { title: en ? "Actions" : "操作", key: "actions", render: (_, row) => <Button onClick={() => navigate(`${base[kind]}/${encodeURIComponent(row.id)}`)}>
              {en ? "Details / edit" : "查看与编辑"}</Button> }
          ]} />
      </ListSection>
    </QueryState></>;
}

/** 保存按钮和回车共用一个Promise；失败锁住重发，先明确重新读取，创建口令只留当前页面。 */
function Editor<Values extends object>({ kind, initial, readOnly = false, unavailable = false, fields, payload }: {
  kind: Kind; initial: Values; readOnly?: boolean; unavailable?: boolean; fields: ReactNode; payload: (values: Values) => Values;
}) {
  const { id } = useParams(), { session, brandName } = usePlatformApplication(), { locale } = useLocale(), en = locale === "en-US";
  const query = useDirectory<Array<SystemUserRow | SystemRoleRow>>(kind), navigate = useNavigate();
  const row = id ? query.data?.find(item => item.id === id) : undefined;
  const [form] = Form.useForm<Values>(), pending = useRef<Promise<unknown> | null>(null), baseline = useRef("");
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<SystemUserRow | SystemRoleRow>(), [reload, setReload] = useState(0);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const newSource = useRef(initial).current;
  const current = useServerFormSync(form, row ?? (!id && query.data ? newSource : undefined), () => {
    form.setFieldsValue(initial); baseline.current = formSnapshotFingerprint(form.getFieldsValue(true)); setDirty(false);
  }, `${kind}:${id ?? "new"}:${reload}`);
  const save = (values: Values) => {
    if (pending.current) return pending.current;
    if (readOnly || unavailable || failed || saved || !current() || query.error || id && !row) return Promise.reject(new Error(en ? "Read and check current data before saving." : "请先读取并核对当前资料。"));
    const submitted = formSnapshotFingerprint(form.getFieldsValue(true));
    setBusy(true);
    const operation = session.runtime.request<SystemUserRow | SystemRoleRow>(`/platform/${kind}${id ? `/${encodeURIComponent(id)}` : ""}`,
      { method: id ? "put" : "post", data: payload({ ...initial, ...values }) }).then(async result => {
      setSaved(result); setDirty(false); notifyFormSaved(form, submitted);
      // 人员创建响应可能含一次性口令，仅放当前编辑器，不写查询缓存或浏览器存储。
      try {
        await session.queryClient.invalidateQueries({ queryKey: ["public-management", session.currentSessionEpoch(), kind] });
        await session.queryClient.invalidateQueries({ queryKey: ["public-core-access-directory", session.currentSessionEpoch()] });
        await session.bootstrap();
      } catch { setRefreshFailed(true); }
      return result;
    }).catch(error => { setFailed(true); throw error; }).finally(() => { pending.current = null; setBusy(false); });
    pending.current = operation; return operation;
  };
  const title = kind === "users" ? en ? "Member details" : "人员资料" : en ? "Role details" : "角色资料";
  return <Form form={form} layout="vertical" disabled={busy || readOnly || Boolean(saved)} requiredMark={false}
    onValuesChange={() => setDirty(formSnapshotFingerprint(form.getFieldsValue(true)) !== baseline.current)}
    onFinish={values => { void save(values).catch(() => undefined); }}>
    <PageHeading title={title} brandName={brandName} extra={<>
      <Button disabled={busy} onClick={() => navigate(base[kind])}>{en ? "Back" : "返回"}</Button>
      {!saved && <ConfirmAction label={en ? "Reload" : "重新读取"} disabled={busy}
        prompt={en ? "Discard the draft and read the current directory?" : "放弃本地草稿，重新读取当前目录？"}
        onConfirm={async () => { const next = await query.refetch(); if (next.isError) throw next.error; setFailed(false); setReload(x => x + 1); }} />}
      {!readOnly && !saved && <SaveButton form={form} label={en ? "Save" : "保存"} onSave={save} pending={busy}
        disabled={unavailable || failed || !query.data || Boolean(query.error) || Boolean(id && !row)} />}
    </>} />
    <QueryState loading={query.isPending} error={query.error} onRetry={query.refetch}>
      {id && !row ? <Result status="404" title="404" /> : <>
        {readOnly && <Alert type="info" title={kind === "roles" ? en ? "Fixed administrator roles are read-only." : "固定管理员角色只读。"
          : en ? "Only a tenant administrator can edit this administrator account." : "只有租户管理员可以修改此管理员账号。"} />}
        {failed && !saved && <Alert type="warning" title={en ? "Save is unconfirmed. Read the original directory before trying again." : "保存未确认，请重新读取原目录核对后再操作。"} />}
        {saved && <Alert type="success" title={en ? "The change is recorded." : "变更已记录。"}
          description={"temporaryPassword" in saved && saved.temporaryPassword
            ? <>{en ? "Temporary password (shown once)" : "一次性临时密码"} <code>{saved.temporaryPassword}</code><CopyButton value={saved.temporaryPassword} /></>
            : en ? "Use the latest directory for the current state." : "当前状态以最新目录读取为准。"} />}
        {refreshFailed && <Alert type="warning" title={en ? "The change is recorded, but the latest directory could not be read. Return to the directory to reload it." : "变更已记录，最新目录未能读到。请返回目录重新读取。"} />}
        {fields}
      </>}
    </QueryState><UnsavedChangesGuard dirty={dirty} busy={busy} />
  </Form>;
}

function RoleEditor() {
  const { id } = useParams(), roles = useDirectory<SystemRoleRow[]>("roles"), permissions = useDirectory<PermissionModule[]>("permission-tree");
  const role = roles.data?.find(item => item.id === id), { locale } = useLocale(), en = locale === "en-US";
  const initial: SaveSystemRoleRequest = role ? { ...role, permissions: [...new Set([...role.permissions, ...role.buttonPermissions])] }
    : { code: "", name: "", description: "", scope: RoleScope.Operator, dataScope: "own", permissions: [], enabledBusinessScopes: [], isActive: true };
  return <Editor<SaveSystemRoleRequest> kind="roles" initial={initial} readOnly={Boolean(role && isFixedRole(role))}
    unavailable={permissions.isPending || Boolean(permissions.error)}
    payload={values => ({ id, code: values.code, name: values.name, description: values.description, scope: values.scope,
      dataScope: values.dataScope, enabledBusinessScopes: values.enabledBusinessScopes, permissions: values.permissions,
      isActive: values.isActive, buttonPermissions: role?.buttonPermissions.filter(code => values.permissions.includes(code)) ?? [] })}
    fields={<SettingsWorkspace sections={[
      { key: "profile", label: en ? "Profile" : "基本资料", content: <FormSection title={en ? "Profile" : "基本资料"}>
        <Form.Item name="code" label={en ? "Code" : "角色编码"} rules={[{ required: true }]}><Input disabled={Boolean(id)} /></Form.Item>
        <Form.Item name="name" label={en ? "Name" : "角色名称"} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="description" label={en ? "Description" : "角色说明"}><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="isActive" valuePropName="checked" label={en ? "Enabled" : "启用"}><Switch /></Form.Item>
      </FormSection> },
      { key: "permissions", label: en ? "Permissions" : "操作权限", content: <QueryState loading={permissions.isPending}
        error={permissions.error} onRetry={permissions.refetch}><Form.Item name="permissions"><PermissionEditor
          modules={permissions.data ?? []} disabled={Boolean(permissions.error || permissions.isPending || role && isFixedRole(role))} /></Form.Item></QueryState> },
      { key: "scope", label: en ? "Data scope" : "数据范围", content: <Form.Item name="dataScope" label={en ? "Data scope" : "数据范围"}>
        <Select options={[{ value: "own", label: en ? "Own" : "本人" }, { value: "organization", label: en ? "Organization" : "组织" },
          { value: "store", label: en ? "Business container" : "业务范围" }, { value: "all", label: en ? "Tenant" : "本租户" }]} /></Form.Item> }
    ]} />} />;
}

function UserEditor() {
  const { id } = useParams(), users = useDirectory<SystemUserRow[]>("users"), { user: actor } = useAdminSession();
  const rolesAllowed = canManagePublicResource(actor, "tenant", "system:role:manage");
  const { session } = usePlatformApplication(), { locale } = useLocale(), en = locale === "en-US";
  const roles = useQuery({ queryKey: ["public-management", session.currentSessionEpoch(), "roles"], enabled: rolesAllowed,
    queryFn: ({ signal }) => session.runtime.request<SystemRoleRow[]>("/platform/roles", { signal }), meta: { liveRefresh: false } });
  const member = users.data?.find(item => item.id === id);
  const initial: SaveSystemUserRequest = member ? { ...member } : { account: "", displayName: "", roleIds: [], isActive: true };
  return <Editor<SaveSystemUserRequest> kind="users" initial={initial} readOnly={Boolean(member?.isPlatformAdmin && !actor?.isPlatformAdmin)}
    unavailable={rolesAllowed ? roles.isPending || Boolean(roles.error) : !id}
    payload={values => ({ id, account: values.account, displayName: values.displayName, phone: values.phone?.trim() || undefined,
      organizationId: values.organizationId, roleIds: values.roleIds, isPlatformAdmin: values.isPlatformAdmin, isActive: values.isActive })} fields={<>
      <Form.Item name="account" label={en ? "Account" : "账号"} rules={[{ required: true }]}><Input autoComplete="off" /></Form.Item>
      <Form.Item name="displayName" label={en ? "Name" : "姓名"} rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="phone" label={en ? "Phone" : "电话"}><Input autoComplete="tel" /></Form.Item>
      {rolesAllowed ? <QueryState loading={roles.isPending} error={roles.error} onRetry={roles.refetch}>
        <Form.Item name="roleIds" label={en ? "Roles" : "角色"} rules={[{ required: !member?.isPlatformAdmin, type: "array", min: 1 }]}>
          <Select mode="multiple" showSearch={false} disabled={Boolean(member?.isPlatformAdmin || roles.error || roles.isPending)}
            options={(roles.data ?? []).filter(role => !isFixedRole(role) || member?.roleIds.includes(role.id))
              .map(role => ({ value: role.id, label: role.name, disabled: !role.isActive }))} />
        </Form.Item></QueryState> : <Alert type="info" title={en ? "Role selection requires current role management access." : "选择角色需要当前角色管理权限。"} />}
      <Form.Item name="isActive" valuePropName="checked" label={en ? "Enabled" : "启用"}><Switch disabled={id === actor?.id} /></Form.Item>
    </>} />;
}

export function PublicManagementPage({ kind, edit = false }: { kind: Kind; edit?: boolean }) {
  const { id } = useParams();
  return <ManagementGate kind={kind}>{edit ? kind === "roles" ? <RoleEditor key={id ?? "new"} /> : <UserEditor key={id ?? "new"} />
    : <Directory kind={kind} />}</ManagementGate>;
}

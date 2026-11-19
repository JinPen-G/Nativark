/** 公共租户/人员/角色页面使用原目录和保存接口；页面权限不替代服务端，Core使用权另外分配。 */
import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { RoleScope, TenantStatus, type CreatePlatformTenantRequest, type CreatePlatformTenantResult,
  type PermissionModule, type PlatformTenantSummary, type ResetUserPasswordResult, type SaveSystemRoleRequest, type SaveSystemUserRequest,
  type SystemRoleRow, type SystemUserRow, type UpdateTenantRequest, type UpdateTenantStatusRequest } from "@rental-os/platform-contracts";
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
import { PublicMemberInvitations } from "./PublicMemberInvitations";
import { hasTenantMessagingPermission } from "../messaging";

const base = { users: "/settings/users", roles: "/settings/roles", tenants: "/platform/tenants" } as const;
type Kind = keyof typeof base;
type DirectoryRow = SystemUserRow | SystemRoleRow | PlatformTenantSummary;
const rowId = (row: DirectoryRow) => "tenantCode" in row ? row.tenantId : row.id;
const rowStatus = (row: DirectoryRow) => "tenantCode" in row ? row.tenantStatus : row.isActive ? "active" : "disabled";
function useDirectory<T>(kind: string, path = `/platform/${kind}`) {
  const { session } = usePlatformApplication();
  return useQuery({ queryKey: ["public-management", session.currentSessionEpoch(), kind],
    queryFn: ({ signal }) => session.runtime.request<T>(path, { signal }), meta: { liveRefresh: false } });
}

function ManagementGate({ kind, creating, children }: { kind: Kind; creating: boolean; children: ReactNode }) {
  const { user, sessionVerified } = useAdminSession();
  const allowed = kind === "tenants" ? canManagePublicResource(user, "saas", "system:tenant:manage")
    && (!creating || canManagePublicResource(user, "saas", "system:tenant:bootstrap"))
    : canManagePublicResource(user, "tenant", kind === "users" ? "system:user:manage" : "system:role:manage");
  return sessionVerified && allowed
    ? children : <Result status="403" title="403" />;
}

function Directory({ kind }: { kind: Kind }) {
  const { brandName } = usePlatformApplication(), { locale } = useLocale(), en = locale === "en-US", navigate = useNavigate();
  const [inviting, setInviting] = useState(false);
  const { user } = useAdminSession(), query = useDirectory<DirectoryRow[]>(kind);
  const filter = useListFilter(query.data, { fields: row => "tenantCode" in row ? [row.tenantCode, row.tenantName]
    : "account" in row ? [row.account, row.displayName] : [row.code, row.name], status: rowStatus });
  const title = { users: en ? "Members" : "人员管理", roles: en ? "Roles" : "角色权限", tenants: en ? "Tenants" : "租户管理" }[kind];
  const canCreate = kind !== "tenants" || canManagePublicResource(user, "saas", "system:tenant:bootstrap");
  return <><PageHeading title={title} brandName={brandName} extra={<>
    {canCreate && <Button onClick={() => navigate(`${base[kind]}/new`)}>{en ? "Create" : "新增"}</Button>}
    {kind === "users" && hasTenantMessagingPermission(user, "system:user:manage")
      && <Button onClick={() => setInviting(true)}>{en ? "Invite members" : "邀请成员"}</Button>}
  </>} />
    <QueryState loading={query.isPending} error={query.error} onRetry={query.refetch}>
      <ListSection controls={<ListFilters filter={filter} placeholder={en ? "Search name or code" : "搜索姓名或编码"}
        options={[{ value: "active", label: en ? "Enabled" : "已启用" }, { value: "disabled", label: en ? "Disabled" : "已停用" },
          ...(kind === "tenants" ? [{ value: "frozen", label: en ? "Frozen" : "已冻结" }] : [])]} />}>
        <Table<DirectoryRow> rowKey={rowId} dataSource={filter.rows} pagination={filter.pagination}
          refreshing={query.isFetching} onRefresh={query.refetch} columns={[
            { title: en ? "Name" : "名称", key: "name", render: (_, row) => <DataTableText
              primary={"tenantCode" in row ? row.tenantName : "account" in row ? row.displayName : row.name}
              secondary={"tenantCode" in row ? row.tenantCode : "account" in row ? row.account : row.code} /> },
            { title: en ? "Access" : "授权", key: "access", render: (_, row) => "tenantCode" in row ? row.operatorShortName ?? "—"
              : "roleNames" in row ? row.roleNames.join("、")
              : isFixedRole(row) ? en ? "Fixed administrator" : "固定管理员" : `${row.permissions.length} ${en ? "permissions" : "项权限"}` },
            { title: en ? "Status" : "状态", key: "status", render: (_, row) => <DataTableStatus tone={rowStatus(row) === "active" ? "success" : "neutral"}>
              {rowStatus(row) === "active" ? en ? "Enabled" : "已启用" : rowStatus(row) === "frozen" ? en ? "Frozen" : "已冻结" : en ? "Disabled" : "已停用"}</DataTableStatus> },
            { title: en ? "Actions" : "操作", key: "actions", render: (_, row) => <>
              <Button onClick={() => navigate(`${base[kind]}/${encodeURIComponent(rowId(row))}`)}>{en ? "Details / edit" : "查看与编辑"}</Button>
              {kind === "tenants" && <Button onClick={() => navigate(`${base.tenants}/${encodeURIComponent(rowId(row))}/status`)}>{en ? "Change status" : "变更状态"}</Button>}
              {"account" in row && row.id !== user?.id && (!row.isPlatformAdmin || user?.isPlatformAdmin) && <Button
                onClick={() => navigate(`${base.users}/${encodeURIComponent(row.id)}/reset-password`)}>{en ? "Reset password" : "重置密码"}</Button>}
              {"code" in row && !isFixedRole(row) && <Button onClick={() => navigate(`${base.roles}/${encodeURIComponent(row.id)}/delete`)}>
                {en ? "Delete" : "删除"}</Button>}
            </> }
          ]} />
      </ListSection>
    </QueryState>
    {kind === "users" && <PublicMemberInvitations open={inviting} onClose={() => setInviting(false)} />}
  </>;
}

/** 保存按钮和回车共用一个Promise；失败锁住重发，先明确重新读取，创建口令只留当前页面。 */
function Editor<Values extends object>({ kind, initial, status = false, readOnly = false, unavailable = false, fields, payload }: {
  kind: Kind; initial: Values; status?: boolean; readOnly?: boolean; unavailable?: boolean; fields: ReactNode; payload: (values: Values) => unknown;
}) {
  const { id } = useParams(), { session, brandName } = usePlatformApplication(), { locale } = useLocale(), en = locale === "en-US";
  const query = useDirectory<DirectoryRow[]>(kind), navigate = useNavigate();
  const row = id ? query.data?.find(item => rowId(item) === id) : undefined;
  const [form] = Form.useForm<Values>(), pending = useRef<Promise<unknown> | null>(null), baseline = useRef("");
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<DirectoryRow | CreatePlatformTenantResult>(), [reload, setReload] = useState(0);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const newSource = useRef(initial).current;
  const current = useServerFormSync(form, row ?? (!id && query.data ? newSource : undefined), () => {
    form.setFieldsValue(initial); baseline.current = formSnapshotFingerprint(form.getFieldsValue(true)); setDirty(false);
  }, `${kind}:${id ?? "new"}:${status}:${reload}`);
  const save = (values: Values) => {
    if (pending.current) return pending.current;
    if (readOnly || unavailable || failed || saved || !current() || query.error || id && !row) return Promise.reject(new Error(en ? "Read and check current data before saving." : "请先读取并核对当前资料。"));
    const submitted = formSnapshotFingerprint(form.getFieldsValue(true));
    setBusy(true);
    const operation = session.runtime.request<DirectoryRow | CreatePlatformTenantResult>(`/platform/${kind}${id ? `/${encodeURIComponent(id)}` : ""}${status ? "/status" : ""}`,
      { method: id ? "put" : "post", data: payload({ ...initial, ...values }) }).then(async result => {
      setSaved(result); setDirty(false); notifyFormSaved(form, submitted);
      // 人员创建响应可能含一次性口令，仅放当前编辑器，不写查询缓存或浏览器存储。
      try {
        await session.queryClient.invalidateQueries({ queryKey: ["public-management", session.currentSessionEpoch(), kind] }, { throwOnError: true });
        await session.queryClient.invalidateQueries({ queryKey: ["public-core-access-directory", session.currentSessionEpoch()] }, { throwOnError: true });
        await session.bootstrap();
      } catch { setRefreshFailed(true); }
      return result;
    }).catch(error => { setFailed(true); throw error; }).finally(() => { pending.current = null; setBusy(false); });
    pending.current = operation; return operation;
  };
  const title = { users: en ? "Member details" : "人员资料", roles: en ? "Role details" : "角色资料",
    tenants: status ? en ? "Tenant status" : "租户状态" : en ? "Tenant details" : "租户资料" }[kind];
  return <Form form={form} layout="vertical" disabled={busy || readOnly} requiredMark={false}
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
    {saved && <Alert type="success" title={en ? "The change is recorded." : "变更已记录。"}
      description={"temporaryPassword" in saved && saved.temporaryPassword
        ? <>{en ? "Temporary password (shown once)" : "一次性临时密码"} <code>{saved.temporaryPassword}</code><CopyButton disabled={false} value={saved.temporaryPassword} /></>
        : en ? "Use the latest directory for the current state." : "当前状态以最新目录读取为准。"} />}
    {refreshFailed && <Alert type="warning" title={en ? "The change is recorded, but the latest directory could not be read. Return to the directory to reload it." : "变更已记录，最新目录未能读到。请返回目录重新读取。"} />}
    {!saved && <QueryState loading={query.isPending} error={query.error} onRetry={query.refetch}>
      {id && !row ? <Result status="404" title="404" /> : <>
        {readOnly && <Alert type="info" title={kind === "roles" ? en ? "Fixed administrator roles are read-only." : "固定管理员角色只读。"
          : en ? "Only a tenant administrator can edit this administrator account." : "只有租户管理员可以修改此管理员账号。"} />}
        {failed && !saved && <Alert type="warning" title={en ? "Save is unconfirmed. Read the original directory before trying again." : "保存未确认，请重新读取原目录核对后再操作。"} />}
        {fields}
      </>}
    </QueryState>}<UnsavedChangesGuard dirty={dirty} busy={busy} />
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
  const rolesAllowed = canManagePublicResource(actor, "tenant", "system:user:manage")
    || canManagePublicResource(actor, "tenant", "system:role:manage");
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
        </Form.Item></QueryState> : <Alert type="info" title={en ? "Role selection requires current member or role management access." : "选择角色需要当前人员或角色管理权限。"} />}
      <Form.Item name="isActive" valuePropName="checked" label={en ? "Enabled" : "启用"}><Switch disabled={id === actor?.id} /></Form.Item>
    </>} />;
}

function TenantEditor({ status }: { status: boolean }) {
  const { id } = useParams(), query = useDirectory<PlatformTenantSummary[]>("tenants"), { locale } = useLocale(), en = locale === "en-US";
  const tenant = query.data?.find(row => row.tenantId === id);
  if (status) return <Editor<UpdateTenantStatusRequest> kind="tenants" status
    initial={{ status: tenant?.tenantStatus ?? TenantStatus.Active, reason: "" }}
    payload={values => ({ status: values.status, reason: values.reason.trim() } satisfies UpdateTenantStatusRequest)} fields={<>
      <Alert type="info" title={tenant?.tenantName ?? ""} description={en ? "Freezing or disabling revokes tenant sessions. Restoring the tenant keeps existing Core and member access settings." : "冻结或停用将撤销租户会话。恢复租户保留原 Core 和成员授权设置。"} />
      <Form.Item name="status" label={en ? "Status" : "状态"} rules={[{ required: true }]}><Select options={[
        { value: TenantStatus.Active, label: en ? "Enabled" : "已启用" }, { value: TenantStatus.Frozen, label: en ? "Frozen" : "已冻结" },
        { value: TenantStatus.Disabled, label: en ? "Disabled" : "已停用" }]} /></Form.Item>
      <Form.Item name="reason" label={en ? "Reason" : "变更原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} /></Form.Item>
    </>} />;
  return <Editor<CreatePlatformTenantRequest> kind="tenants" initial={{ tenantCode: tenant?.tenantCode ?? "", tenantName: tenant?.tenantName ?? "",
    operatorShortName: tenant?.operatorShortName ?? "", adminAccount: "", adminDisplayName: "", adminPhone: "" }}
    payload={values => id ? { tenantName: values.tenantName, operatorShortName: values.operatorShortName } satisfies UpdateTenantRequest
      : { tenantCode: values.tenantCode, tenantName: values.tenantName, operatorShortName: values.operatorShortName,
        adminAccount: values.adminAccount, adminDisplayName: values.adminDisplayName, adminPhone: values.adminPhone?.trim() || undefined } satisfies CreatePlatformTenantRequest}
    fields={<><Form.Item name="tenantCode" label={en ? "Tenant code" : "租户编码"} rules={[{ required: true, whitespace: true }]}><Input disabled={Boolean(id)} /></Form.Item>
      <Form.Item name="tenantName" label={en ? "Tenant name" : "租户名称"} rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
      <Form.Item name="operatorShortName" label={en ? "Short name" : "后台简称"} rules={[{ max: 64 }]}><Input maxLength={64} /></Form.Item>
      {!id && <FormSection title={en ? "Tenant administrator" : "租户管理员"}>
        <Form.Item name="adminAccount" label={en ? "Account" : "管理员账号"} rules={[{ required: true, whitespace: true }]}><Input autoComplete="off" /></Form.Item>
        <Form.Item name="adminDisplayName" label={en ? "Name" : "管理员姓名"} rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item name="adminPhone" label={en ? "Phone" : "电话"}><Input autoComplete="tel" /></Form.Item>
        <Alert type="info" title={en ? "The tenant starts without a business Core. Save the temporary password and enable Core access separately." : "租户创建后不含业务 Core。请保存返回的临时密码，再单独授权 Core。"} />
      </FormSection>}</>} />;
}

/** 重置/删除是单次明确确认；原响应和随后目录读取分开，口令不进入查询缓存。 */
function AccessAction({ kind }: { kind: "users" | "roles" }) {
  const { id } = useParams(), { user } = useAdminSession(), { session, brandName } = usePlatformApplication();
  const { locale } = useLocale(), en = locale === "en-US", navigate = useNavigate();
  const query = useDirectory<Array<SystemUserRow | SystemRoleRow>>(kind), row = query.data?.find(item => item.id === id);
  const pending = useRef<Promise<unknown> | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [refreshFailed, setRefreshFailed] = useState(false);
  const [saved, setSaved] = useState<ResetUserPasswordResult | { id: string; deleted: true }>();
  const allowed = row && ("account" in row ? row.id !== user?.id && (!row.isPlatformAdmin || user?.isPlatformAdmin) : !isFixedRole(row));
  const submit = () => {
    if (pending.current) return pending.current;
    if (!allowed || query.error || failed || saved) return Promise.reject(new Error(en ? "Read and check the current account or role first." : "请先读取并核对当前账号或角色。"));
    setBusy(true);
    const operation = session.runtime.request<ResetUserPasswordResult | { id: string; deleted: true }>(
      `/platform/${kind}/${encodeURIComponent(row.id)}${kind === "users" ? "/reset-password" : ""}`,
      { method: kind === "users" ? "post" : "delete" }).then(async result => {
      setSaved(result);
      try {
        await session.queryClient.invalidateQueries({ queryKey: ["public-management", session.currentSessionEpoch(), kind] }, { throwOnError: true });
        await session.queryClient.invalidateQueries({ queryKey: ["public-core-access-directory", session.currentSessionEpoch()] }, { throwOnError: true });
        await session.bootstrap();
      } catch { setRefreshFailed(true); }
      return result;
    }).catch(error => { setFailed(true); throw error; }).finally(() => { pending.current = null; setBusy(false); });
    pending.current = operation; return operation;
  };
  return <><PageHeading brandName={brandName} title={kind === "users" ? en ? "Reset member password" : "重置成员密码" : en ? "Delete role" : "删除角色"}
    extra={<Button disabled={busy} onClick={() => navigate(base[kind])}>{en ? "Back" : "返回"}</Button>} />
      {saved ? <Alert type="success" title={en ? "The change is recorded." : "变更已记录。"}
        description={"temporaryPassword" in saved ? <>{en ? "Temporary password (shown once)" : "一次性临时密码"} <code>{saved.temporaryPassword}</code>
          <CopyButton value={saved.temporaryPassword} /></> : en ? "The role is deleted." : "角色已删除。"} />
        : <QueryState loading={query.isPending} error={query.error} onRetry={query.refetch}>
          {!row ? <Result status="404" title="404" /> : !allowed ? <Result status="403" title="403" /> : <>
          <Alert type="info" title={"account" in row ? `${row.displayName} · ${row.account}` : `${row.name} · ${row.code}`}
            description={kind === "users" ? en ? "This revokes existing sessions. The member must change the temporary password at next sign-in." : "重置将撤销旧会话，成员下次登录必须修改临时密码。"
              : en ? "Fixed or assigned roles cannot be deleted. The server checks the current assignments when you confirm." : "固定角色或已分配角色不能删除，确认时由服务端核对当前关联。"} />
          {failed && <><Alert type="warning" title={en ? "The result is unconfirmed. Check the current directory before confirming a new operation." : "结果未确认，请先核对当前目录，再明确发起新操作。"}
            description={kind === "users" ? en ? "A new reset replaces any previously issued password; the old password cannot be retrieved." : "再次重置会替换此前的密码，旧临时密码不能重新读取。" : undefined} />
            <ConfirmAction label={en ? "Read current directory" : "读取当前目录"} disabled={busy}
              prompt={en ? "Read the current state before starting a new operation?" : "读取当前状态后，再决定是否发起新操作？"}
              onConfirm={async () => { const latest = await query.refetch(); if (latest.isError) throw latest.error; setFailed(false); }} /></>}
          <ConfirmAction label={kind === "users" ? en ? "Reset password" : "重置密码" : en ? "Delete role" : "删除角色"} disabled={busy || failed}
            prompt={kind === "users" ? en ? "Revoke old sessions and issue a new temporary password?" : "撤销旧会话并签发新的临时密码？" : en ? "Delete this unassigned role?" : "确认删除此未分配角色？"}
            onConfirm={submit} />
        </>}
      </QueryState>}
      {refreshFailed && <Alert type="warning" title={en ? "The change is recorded. Return to the directory to read its current state." : "变更已记录，请返回目录重新读取当前状态。"} />}
    <UnsavedChangesGuard dirty={false} busy={busy} /></>;
}

export function PublicManagementPage({ kind, edit = false, status = false, action = false }: { kind: Kind; edit?: boolean; status?: boolean; action?: boolean }) {
  const { id } = useParams();
  return <ManagementGate kind={kind} creating={edit && !id}>{action && kind !== "tenants" ? <AccessAction key={id} kind={kind} />
    : edit ? kind === "tenants" ? <TenantEditor key={`${id ?? "new"}:${status}`} status={status} />
    : kind === "roles" ? <RoleEditor key={id ?? "new"} /> : <UserEditor key={id ?? "new"} />
    : <Directory kind={kind} />}</ManagementGate>;
}

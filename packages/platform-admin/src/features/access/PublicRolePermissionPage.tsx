/** 原角色列表、权限矩阵和编辑侧窗的公共单源呈现。
 * 矩阵只生成草稿，保存复核原角色基线与当前会话，Core 默认值由可选适配提供。 */
import type { SaveSystemRoleRequest, SystemDataScope, SystemRoleRow } from "@rental-os/platform-contracts";
import { RoleScope } from "@rental-os/platform-contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, Row, Space, Tag } from "antd";
import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLocale } from "../../app/locale";
import { canManagePublicResource } from "../../application-access";
import { InsightMetrics } from "../../components/InsightMetrics";
import { QueryState } from "../../components/QueryState";
import { SettingsWorkspace } from "../../components/settings/SettingsWorkspace";
import { Alert, App, Button, ConfirmAction, DataTableText, Drawer, Form, FormSection, Input,
  ListFilters, ListSection, Result, SaveButton, Segmented, Select, Switch, Table, useListFilter } from "../../components/ui";
import { EditOutlined, PlusOutlined } from "../../components/ui/icons";
import { useAdminRuntime, useAdminSession } from "../../runtime";
import { ManagementPageHeading, usePublicManagementCoreAdapter, type ManagementHeading, type ManagementRoleDefaults } from "./management-adapter";
import { usePublicManagementApi } from "./management-client";
import { PermissionEditor, PermissionMatrix } from "./PermissionMatrix";
import { isFixedRole, permissionDraftChanges, rolePermissionBaseline, type PermissionDraft, type RoleEditorTarget } from "./permission-matrix-model";
import accessStyles from "./TenantAccess.module.css";

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

function dataScopeTag(scope: SystemDataScope, translate: (value: string) => string) {
  return <Tag color={scope === "all" ? "purple" : scope === "own" ? "default" : "blue"}>{translate(DATA_SCOPE_OPTIONS.find(item => item.value === scope)?.label ?? scope)}</Tag>;
}

export function PublicRolePermissionPage({ Heading = ManagementPageHeading, defaults, routeEdit = false, routeAction = false }: {
  Heading?: ManagementHeading;
  defaults?: ManagementRoleDefaults;
  routeEdit?: boolean;
  routeAction?: boolean;
}) {
  const { message, modal } = App.useApp();
  const { t } = useLocale();
  const runtime = useAdminRuntime();
  const { user, sessionVerified } = useAdminSession();
  const core = usePublicManagementCoreAdapter();
  const api = usePublicManagementApi();
  const queryClient = useQueryClient();
  const epoch = runtime.currentSessionEpoch();
  const roleKey = ["public-management", epoch, "roles"] as const;
  const allowed = sessionVerified && canManagePublicResource(user, "tenant", "system:role:manage");
  const roles = useQuery({ queryKey: roleKey, queryFn: ({ signal }) => api.roles(signal), enabled: allowed, meta: { liveRefresh: false } });
  const permissions = useQuery({ queryKey: ["public-management", epoch, "permission-tree"], queryFn: ({ signal }) => api.permissionTree(signal), enabled: allowed, meta: { liveRefresh: false } });
  const roleFilter = useListFilter(roles.data, { fields: row => [row.name, row.code], status: row => row.isActive ? "active" : "disabled" });
  const [form] = Form.useForm<SaveSystemRoleRequest>();
  const [editing, setEditing] = useState<SystemRoleRow>();
  const [open, setOpen] = useState(false);
  const [roleView, setRoleView] = useState("matrix");
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft | null>(null);
  const [editorSection, setEditorSection] = useState("profile");
  const [editorQuery, setEditorQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const pending = useRef<Promise<SystemRoleRow> | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const readOnlyRole = Boolean(editing && isFixedRole(editing));
  const reviewChanges = editing && permissionDraft?.roleId === editing.id ? permissionDraftChanges(editing, permissionDraft) : undefined;
  const permissionNames = new Map((permissions.data ?? []).flatMap(module => module.children.map(permission => [permission.code, t(permission.name)])));
  const navigate = useNavigate();
  const { id } = useParams();
  const routeOpened = useRef<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  function currentSignal() {
    const current = runtime.getSession();
    if (!lifetime.current || lifetime.current.signal.aborted || runtime.currentSessionEpoch() !== epoch
      || !current.sessionVerified || !canManagePublicResource(current.user, "tenant", "system:role:manage")) {
      throw new DOMException("原角色管理页面已失效", "AbortError");
    }
    return lifetime.current.signal;
  }

  const save = useMutation({
    mutationFn: (values: SaveSystemRoleRequest) => {
      const signal = currentSignal();
      const current = queryClient.getQueryData<SystemRoleRow[]>(roleKey)?.find(role => role.id === values.id);
      if (failed || roles.error || permissions.error || !roles.data || !permissions.data
        || values.id && (!current || !editing || rolePermissionBaseline(editing) !== rolePermissionBaseline(current))
        || current && permissionDraft?.roleId === current.id && permissionDraft.baseline !== rolePermissionBaseline(current)) {
        throw new Error(t("角色资料已更新，请放弃旧草稿后重新核对。"));
      }
      if (current && isFixedRole(current)) throw new Error(t("系统预设角色的权限不可修改。"));
      return api.saveRole(values, signal);
    },
    onSuccess: async saved => {
      currentSignal();
      setPermissionDraft(current => current?.roleId === saved.id ? null : current);
      setOpen(false);
      message.success(t("角色权限已保存"));
      try {
        await queryClient.invalidateQueries({ queryKey: roleKey }, { throwOnError: true });
        currentSignal();
        if (routeEdit) navigate("/settings/roles");
      } catch {
        if (!lifetime.current?.signal.aborted && runtime.currentSessionEpoch() === epoch) {
          message.warning(t("变更已记录，请返回目录重新读取当前状态。"));
        }
      }
    },
    onError: error => {
      if (lifetime.current?.signal.aborted || runtime.currentSessionEpoch() !== epoch) return;
      setFailed(true);
      message.error(t(error instanceof DOMException && error.name === "AbortError"
        ? "原角色管理页面已失效" : "角色保存失败，请检查编码和权限"));
    }
  });
  const remove = useMutation({
    mutationFn: (roleId: string) => {
      const current = queryClient.getQueryData<SystemRoleRow[]>(roleKey)?.find(role => role.id === roleId);
      if (!current || isFixedRole(current) || roles.error) throw new Error(t("系统预设角色的权限不可修改。"));
      return api.deleteRole(roleId, currentSignal());
    },
    onSuccess: async () => {
      currentSignal();
      message.success(t("角色已删除"));
      try { await queryClient.invalidateQueries({ queryKey: roleKey }, { throwOnError: true }); }
      catch { if (!lifetime.current?.signal.aborted && runtime.currentSessionEpoch() === epoch) message.warning(t("变更已记录，请返回目录重新读取当前状态。")); }
    },
    onError: () => { if (!lifetime.current?.signal.aborted && runtime.currentSessionEpoch() === epoch) message.error(t("角色仍被账号或空间使用，不能删除")); }
  });

  function submit(values: SaveSystemRoleRequest) {
    if (pending.current) return pending.current;
    const operation = save.mutateAsync({ ...values, id: editing?.id, buttonPermissions: [] }).finally(() => {
      if (pending.current === operation) pending.current = null;
    });
    pending.current = operation;
    return operation;
  }

  function openEditor(role?: SystemRoleRow, target: RoleEditorTarget = {}) {
    if (pending.current || roles.error || permissions.error || !roles.data || !permissions.data) return;
    if (target.draft && (!role || target.draft.roleId !== role.id || target.draft.baseline !== rolePermissionBaseline(role))) {
      message.warning(t("角色资料已更新，请放弃旧草稿后重新核对。"));
      return;
    }
    setEditing(role);
    setFailed(false);
    setEditorSection(target.section ?? "profile");
    setEditorQuery(target.query ?? "");
    form.resetFields();
    const initial = defaults ?? core?.tenantRoleDefaults ?? { scope: RoleScope.Operator, enabledBusinessScopes: [], dataScope: "own" };
    form.setFieldsValue(role ? {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      scope: role.scope,
      enabledBusinessScopes: role.enabledBusinessScopes,
      permissions: isFixedRole(role) ? (permissions.data ?? []).flatMap(module => module.children.map(permission => permission.code))
        : target.draft?.permissions ?? [...new Set([...role.permissions.filter(item => item !== "*"), ...role.buttonPermissions.filter(item => item !== "*")])],
      dataScope: role.dataScope,
      isActive: role.isActive
    } : { code: "", name: "", ...initial, permissions: [], isActive: true });
    setOpen(true);
  }

  useEffect(() => {
    if ((!routeEdit && !routeAction) || !roles.data || !permissions.data || roles.error || permissions.error || !allowed) return;
    const target = id ?? "new";
    if (routeOpened.current === target) return;
    const role = id ? roles.data.find(item => item.id === id) : undefined;
    if (id && !role) return;
    routeOpened.current = target;
    if (routeAction && role) {
      if (isFixedRole(role)) return;
      modal.confirm({ title: t("删除角色") + " " + role.name + "？", content: t("已分配给账号或空间的角色不能删除。"),
        onOk: () => remove.mutateAsync(role.id), afterClose: () => navigate("/tenant/roles") });
    } else openEditor(role);
  }, [routeEdit, routeAction, id, roles.data, permissions.data, roles.error, permissions.error, allowed]);

  if (!allowed) return <Result status="403" title="403" />;
  if ((routeEdit || routeAction) && id && roles.data && !roles.data.some(role => role.id === id)) return <Result status="404" title="404" />;

  return <>
    <Heading title={t("角色权限管理")} summary={<InsightMetrics items={[{ label: t("角色"), value: roleView === "matrix" ? roles.data?.length : roleFilter.rows.length }, { label: t("权限模块"), value: permissions.data?.length }]} />}
      view={<Segmented aria-label={t("角色视图")} value={roleView} onChange={value => setRoleView(String(value))} options={[{ value: "matrix", label: t("权限对照") }, { value: "list", label: t("角色列表") }]} />}
      extra={<Button type="primary" icon={<PlusOutlined />} disabled={save.isPending || !roles.data || !permissions.data || Boolean(roles.error || permissions.error)} onClick={() => openEditor()}>{t("新增角色")}</Button>} />
    <QueryState loading={roles.isLoading || permissions.isLoading} error={roles.error ?? permissions.error}>
      <p className={accessStyles.scopeNotice}><Info size={14} aria-hidden="true" />{t("决定操作获准后可访问的数据边界。当前空间隔离已强制生效；组织/本人范围仍需各业务模块逐项接入。")}</p>
      <div hidden={roleView !== "matrix"}><PermissionMatrix roles={roles.data ?? []} modules={permissions.data ?? []} onEdit={openEditor} draft={permissionDraft} onDraftChange={setPermissionDraft}
        busy={roles.isFetching || permissions.isFetching || save.isPending} onRefresh={() => Promise.all([roles.refetch({ throwOnError: true }), permissions.refetch({ throwOnError: true })])} /></div>
      {roleView === "list" && <ListSection controls={<ListFilters filter={roleFilter} placeholder="角色名称或编码" options={[{ value: "active", label: "已启用" }, { value: "disabled", label: "已停用" }]} />}>
        <Table<SystemRoleRow> toolbarNote={false} rowKey="id" onRefresh={() => roles.refetch()} loading={roles.isLoading} refreshing={roles.isFetching} dataSource={roleFilter.rows} pagination={roleFilter.pagination} scroll={{ x: 980 }} columns={[
          { title: t("角色"), width: 220, render: (_, record) => <DataTableText primary={record.name} secondary={record.code} /> },
          { title: t("适用层级"), dataIndex: "scope", width: 130, render: (value) => <Tag>{t(SCOPE_LABELS[value] ?? value)}</Tag> },
          { title: t("默认数据范围"), dataIndex: "dataScope", width: 200, render: (value: SystemDataScope) => dataScopeTag(value, t) },
          { title: t("操作权限"), width: 130, render: (_, record) => record.fixedAllPermissions ? <Tag color="purple">{t("全部权限")}</Tag> : `${new Set([...record.permissions, ...record.buttonPermissions]).size} ${t("项")}` },
          { title: t("状态"), dataIndex: "isActive", width: 100, render: (value) => <Tag color={value ? "success" : "default"}>{t(value ? "启用" : "停用")}</Tag> },
          { title: t("操作"), fixed: "right", width: 170, render: (_, record) => record.fixedAllPermissions ? <Tag>{t("系统预设")}</Tag> : <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openEditor(record)}>{t("编辑")}</Button><ConfirmAction label={t("删除")} disabled={remove.isPending} prompt={<>{`${t("删除角色")} ${record.name}？`} {t("已分配给账号或空间的角色不能删除。")}</>} onConfirm={() => remove.mutateAsync(record.id)} /></Space> }
        ]} />
      </ListSection>}
    </QueryState>

    <Drawer title={readOnlyRole ? t("查看角色") : editing ? t("编辑角色") : t("新增角色")} open={open} size="large" destroyOnHidden
      onClose={() => { if (!pending.current) { setOpen(false); if (routeEdit) navigate("/settings/roles"); } }}
      extra={readOnlyRole ? undefined : <SaveButton label={t("保存角色")} form={form} pending={save.isPending} disabled={failed} onSave={submit} />}>
      {failed && <Alert type="warning" title={t("保存未确认，请重新读取原目录核对后再操作。")}
        description={<ConfirmAction label={t("重新读取")} prompt={t("放弃本地草稿，重新读取当前目录？")} onConfirm={async () => {
          const result = await roles.refetch({ throwOnError: true });
          currentSignal();
          const role = editing ? result.data?.find(item => item.id === editing.id) : undefined;
          if (editing && !role) throw new Error(t("角色资料已更新，请放弃旧草稿后重新核对。"));
          setPermissionDraft(null);
          openEditor(role);
        }} />} />}
      {editing && <div className={accessStyles.reviewChanges}><strong>{editing.name}</strong>{readOnlyRole && <p>{t("系统预设角色的权限不可修改。")}</p>}
        {reviewChanges && <><p>{t("核对本次权限修改后保存；取消关闭会保留矩阵中的草稿。")}</p>
          <p>{t("新增")} {reviewChanges.added.length} · {reviewChanges.added.map(code => permissionNames.get(code) ?? code).join("、") || t("无")}</p>
          <p>{t("移除")} {reviewChanges.removed.length} · {reviewChanges.removed.map(code => permissionNames.get(code) ?? code).join("、") || t("无")}</p>
        </>}
      </div>}
      <Form<SaveSystemRoleRequest> form={form} layout="vertical" disabled={readOnlyRole || save.isPending || failed} onFinish={values => { void submit(values).catch(() => undefined); }}>
        <SettingsWorkspace value={editorSection} onChange={setEditorSection} sections={[
          { key: "profile", label: t("基本资料"), content: <FormSection title={t("基本资料")}>
            <Row gutter={16}>
              <Col span={12}><Form.Item name="name" label={t("角色名称")} rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="code" label={t("角色编码")} rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
              <Col span={12}><Form.Item name="scope" label={t("适用层级")} rules={[{ required: true }]}><Select options={Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col>
              <Col span={24}><Form.Item name="description" label={t("角色说明")}><Input.TextArea rows={2} /></Form.Item></Col>
              <Col span={24}><Form.Item name="isActive" label={t("启用角色")} valuePropName="checked"><Switch /></Form.Item></Col>
            </Row>
          </FormSection> },
          { key: "permissions", label: t("操作权限"), content: <FormSection title={t("操作权限")} description={t("按模块勾选页面访问和具体操作。未勾选即拒绝，前端隐藏不替代后端鉴权。") }>
            <Form.Item name="permissions"><PermissionEditor key={`${editing?.id ?? "new"}:${editorQuery}`} initialQuery={editorQuery} modules={permissions.data ?? []} disabled={readOnlyRole || save.isPending || failed} /></Form.Item>
          </FormSection> },
          { key: "scope", label: t("数据范围"), content: <FormSection title={t("数据范围")} description={t("决定操作获准后可访问的数据边界。当前空间隔离已强制生效；组织/本人范围仍需各业务模块逐项接入。") }>
            <Form.Item name="dataScope" label={t("默认数据范围")} rules={[{ required: true }]}><Select options={DATA_SCOPE_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))} /></Form.Item>
          </FormSection> }
        ]} />
        <Form.Item name="enabledBusinessScopes" hidden><Select mode="multiple" /></Form.Item>
      </Form>
    </Drawer>
  </>;
}

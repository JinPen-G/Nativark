/** 原空间授权的数据和表单仅随 Rental 选装进入宿主。
 * 账号与空间权限仍由原 access 接口一次保存，Core 撤权后停止读取和旧回调。 */
import type { BusinessWorkspace, SaveSystemUserAccessRequest, WorkspaceMember } from "@rental-os/rental-core";
import type { SystemDataScope, SystemRoleRow, SystemUserRow } from "@rental-os/platform-contracts";
import { PublicOperationsAccountPage, type PublicUserBusinessAccess } from "@rental-os/platform-admin/access";
import { useAdminRuntime, useAdminSession } from "@rental-os/platform-admin/runtime";
import { useCoreSession } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import { QueryState } from "@rental-os/platform-admin/shell";
import { Accordion, DataTableText, Empty, Form, FormSection, Select, Switch } from "@rental-os/platform-admin/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Space, Tag, Typography } from "antd";
import { useMemo, useRef, useState, type ComponentProps } from "react";
import { OperatorInvitations } from "./OperatorInvitations";

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


export function RentalOperationsAccountPage(props: Omit<ComponentProps<typeof PublicOperationsAccountPage>, "business">) {
  const core = useCoreSession();
  if (core.isPending || core.error) return <QueryState loading={core.isPending} error={core.error} onRetry={core.refetch}>{null}</QueryState>;
  return core.canAccess("rental", []) ? <RentalAccountContents {...props} assertCore={() => {
    if (!core.canAccess("rental", [])) throw new DOMException("原空间授权页面已失效", "AbortError");
  }} /> : <PublicOperationsAccountPage {...props} />;
}

/** 原未选 Core 的旧组合沿既有身份/Guard；已选组合只从上面的实时 Core 门禁进入。 */
export function OriginalRentalOperationsAccountPage(props: Omit<ComponentProps<typeof PublicOperationsAccountPage>, "business">) {
  return <RentalAccountContents {...props} />;
}

function RentalAccountContents({ assertCore, ...props }: Omit<ComponentProps<typeof PublicOperationsAccountPage>, "business"> & { assertCore?: () => void }) {
  const runtime = useAdminRuntime(), session = useAdminSession(), { t } = useLocale(), queryClient = useQueryClient();
  const epoch = runtime.currentSessionEpoch(), key = ["rental-account-access", epoch] as const;
  const enabled = session.sessionVerified && Boolean(session.user && !session.user.isSaasAdmin);
  const assertCurrent = () => {
    const live = runtime.getSession();
    if (runtime.currentSessionEpoch() !== epoch || !live.sessionVerified || !live.user || live.user.isSaasAdmin) throw new DOMException("原空间授权页面已失效", "AbortError");
    assertCore?.();
  };
  const workspaces = useQuery({ queryKey: [...key, "workspaces"], enabled,
    queryFn: ({ signal }) => { assertCurrent(); return runtime.request<BusinessWorkspace[]>("/platform/workspaces", { signal }); }, meta: { liveRefresh: false } });
  const ids = (workspaces.data ?? []).map(item => item.id).join(",");
  const members = useQuery({ queryKey: [...key, "members", ids], enabled: enabled && Boolean(workspaces.data),
    queryFn: ({ signal }) => Promise.all((workspaces.data ?? []).map(async workspace => {
      assertCurrent();
      return { workspaceId: workspace.id, members: await runtime.request<WorkspaceMember[]>("/platform/workspaces/" + encodeURIComponent(workspace.id) + "/members", { signal }) };
    })), meta: { liveRefresh: false } });
  const locations = useQuery({ queryKey: [...key, "fulfillment-locations", ids], enabled: enabled && Boolean(workspaces.data),
    queryFn: ({ signal }) => Promise.all((workspaces.data ?? []).map(async workspace => {
      assertCurrent();
      return { workspaceId: workspace.id, locations: await runtime.request<Array<{ id: string; name: string; code: string; status: string }>>("/platform/workspaces/" + encodeURIComponent(workspace.id) + "/fulfillment-locations", { signal }) };
    })), meta: { liveRefresh: false } });
  const [accessRows, setAccessRows] = useState<WorkspaceAccessRow[]>([]);
  const workspaceMap = useMemo(() => new Map((workspaces.data ?? []).map(workspace => [workspace.id, workspace])), [workspaces.data]);
  const memberRows = useMemo(() => (members.data ?? []).flatMap(group => group.members), [members.data]);
  const locationsByWorkspace = useMemo(() => new Map((locations.data ?? []).map(group => [group.workspaceId, group.locations])), [locations.data]);
  const baseline = useRef<string | undefined>(undefined);
  const currentData = () => JSON.stringify([queryClient.getQueryData([...key, "workspaces"]), queryClient.getQueryData([...key, "members", ids]), queryClient.getQueryData([...key, "fulfillment-locations", ids])]);
  const error = workspaces.error ?? members.error ?? locations.error;
  const ready = enabled && Boolean(workspaces.data && members.data && locations.data && !error);
  function updateAccess(workspaceId: string, patch: Partial<WorkspaceAccessRow>) {
    assertCurrent(); setAccessRows(rows => rows.map(row => row.workspaceId === workspaceId ? { ...row, ...patch } : row));
  }
  const business: PublicUserBusinessAccess = {
    loading: workspaces.isLoading || members.isLoading || locations.isLoading, error, ready, assertCurrent,
    openEditor(user, defaultRoleId, roles) {
      assertCurrent();
      const roleMap = new Map(roles.map(role => [role.id, role]));
      baseline.current = currentData();
      const currentWorkspaces = queryClient.getQueryData<BusinessWorkspace[]>([...key, "workspaces"]) ?? [];
      const currentMembers = (queryClient.getQueryData<Array<{ workspaceId: string; members: WorkspaceMember[] }>>([...key, "members", ids]) ?? []).flatMap(group => group.members);
      setAccessRows(currentWorkspaces.map(workspace => {
        const member = currentMembers.find(item => item.workspaceId === workspace.id && item.userId === user?.id);
        return { workspaceId: workspace.id, enabled: member?.isActive ?? false,
          roleId: member?.roleId ?? user?.roleIds[0] ?? defaultRoleId,
          dataScope: member?.dataScope ?? roleMap.get(member?.roleId ?? user?.roleIds[0] ?? "")?.dataScope ?? "store",
          locationScope: member?.locationScope ?? { mode: "all", locationIds: [] }, existed: Boolean(member) };
      }));
    },
    async saveUser(values, signal) {
      assertCurrent();
      if (!ready || baseline.current !== currentData()) throw new Error(t("请先读取并核对当前资料。"));
      const payload: SaveSystemUserAccessRequest = { ...values, workspaceAccesses: accessRows
        .filter(row => workspaceMap.get(row.workspaceId)?.status === "active" && (row.enabled || row.existed))
        .map(row => ({ workspaceId: row.workspaceId, roleId: row.roleId, dataScope: row.dataScope, locationScope: row.locationScope, isActive: row.enabled })) };
      const result = await runtime.request<SystemUserRow>(payload.id ? "/platform/users/" + encodeURIComponent(payload.id) + "/access" : "/platform/users/access",
        { method: payload.id ? "put" : "post", data: payload, signal, retryAuthentication: false });
      assertCurrent(); return result;
    },
    refresh: () => queryClient.invalidateQueries({ queryKey: key }, { throwOnError: true }),
    renderAccess(record) {
      const accessible = memberRows.filter(member => member.userId === record.id && member.isActive);
      return accessible.length ? <Space size={[4, 4]} wrap>{accessible.map(member => <Tag key={member.workspaceId}>{workspaceMap.get(member.workspaceId)?.name ?? member.workspaceId}</Tag>)}</Space>
        : <Typography.Text type="secondary">{t("未授权")}</Typography.Text>;
    },
    editorSection({ editing, currentUserId, activeRoles, roles, classNames }) {
      const roleMap = new Map(roles.map(role => [role.id, role]));
      return { key: "access", label: t("经营空间授权"), content: <FormSection title={t("经营空间授权")}
            description={t("启用空间后必须指定该空间的角色；数据范围可覆盖角色默认值。关闭空间会使该账号无法进入该空间。")}>
            {editing?.id === currentUserId && <p className={classNames.permissionSummary}>{t("当前登录账号的空间授权不可在此修改。")}</p>}
            <Accordion defaultOpen={0} items={accessRows.map(row => {
              const workspace = workspaceMap.get(row.workspaceId);
              const locked = editing?.id === currentUserId || workspace?.status !== "active";
              const disabled = !row.enabled || locked;
              const locations = (locationsByWorkspace.get(row.workspaceId) ?? []).filter(location => location.status === "enabled");
              return {
                key: row.workspaceId,
                title: <DataTableText primary={workspace?.name ?? row.workspaceId} secondary={workspace?.code} />,
                extra: <Space size={8}><span className={classNames.permissionSummary}>{t("允许访问")}</span><Switch aria-label={`${workspace?.name ?? row.workspaceId} · ${t("允许访问")}`} checked={row.enabled} disabled={locked} onChange={enabled => updateAccess(row.workspaceId, { enabled })} /></Space>,
                content: <div className={classNames.workspaceFields}>
                  <Form.Item label={t("空间角色（操作权限）")} htmlFor={`workspace-role-${row.workspaceId}`}>
                    <Select id={`workspace-role-${row.workspaceId}`} disabled={disabled} value={row.roleId}
                      options={activeRoles.map(role => ({ value: role.id, label: `${role.name} · ${t(SCOPE_LABELS[role.scope] ?? role.scope)}` }))}
                      onChange={roleId => updateAccess(row.workspaceId, { roleId, dataScope: roleMap.get(roleId)?.dataScope ?? row.dataScope })} />
                  </Form.Item>
                  <Form.Item label={t("数据范围")} htmlFor={`workspace-scope-${row.workspaceId}`}>
                    <Select id={`workspace-scope-${row.workspaceId}`} disabled={disabled} value={row.dataScope}
                      options={DATA_SCOPE_OPTIONS.map(({ value, label }) => ({ value, label: t(value === "all" ? "当前空间全部数据" : label) }))}
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
          </FormSection> };
    },
    invitations: input => <OperatorInvitations {...input} workspaces={workspaces.data ?? []} />,
  };
  return <PublicOperationsAccountPage {...props} business={business} />;
}

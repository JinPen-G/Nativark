/** 公共目录选择真实租户/成员和已登记Core；授权命令及原结果由同一Core管理面板处理。 */
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { CoreSessionContext } from "@rental-os/core-contracts";
import type { PlatformTenantSummary, SystemUserRow } from "@rental-os/platform-contracts";
import { Alert, Empty, ListFilterBar, ListFilterItem, Result, Select } from "./components/ui";
import { PageHeading, QueryState } from "./shell";
import { CoreDeploymentAdmissionPanel, CoreMemberAssignmentPanel, CoreTenantGrantPanel, useCoreManagementApi, useCoreSession } from "./core";
import { useAdminSession } from "./runtime";
import { useLocale } from "./app/locale";
import { usePlatformApplication } from "./application-context";
import { canManagePublicResource } from "./application-access";

type Target = { id: string; name: string; label: string; status: "active" | "frozen" | "disabled" };

function AccessDirectory({ audience, cores, targets, loading, error, retry }: {
  audience: "saas" | "tenant"; cores: readonly Pick<CoreSessionContext["assignable"][number], "id" | "name">[];
  targets: readonly Target[]; loading: boolean; error: unknown; retry: () => unknown;
}) {
  const { brandName } = usePlatformApplication(), { locale } = useLocale(), en = locale === "en-US";
  const [params, setParams] = useSearchParams();
  const target = targets.find(item => item.id === params.get("target"));
  const core = cores.find(item => item.id === params.get("core"));
  const title = audience === "saas" ? en ? "Tenant Core access" : "租户 Core 授权" : en ? "Member Core access" : "成员 Core 分配";
  const targetLabel = audience === "saas" ? en ? "Tenant" : "租户" : en ? "Member" : "成员";
  const selectionMissing = params.has("target") && !target || params.has("core") && !core;
  const choose = (key: "target" | "core", value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };
  return <><PageHeading title={title} brandName={brandName} />
    <QueryState loading={loading} error={error} onRetry={retry}>
      {selectionMissing && <Alert type="warning" title={en ? "The selection is outside the current authorized directory. Choose it again." : "所选对象不在当前授权目录中，请重新选择。"} />}
      {!error && !loading && (!cores.length
        ? <Empty description={audience === "saas" ? en ? "No Core is registered in this deployment." : "当前部署尚未注册业务 Core。"
          : en ? "Ask your SaaS administrator to enable a Core for this tenant." : "请联系 SaaS 管理员为租户开通业务 Core。"} />
        : <>
          <ListFilterBar>
            {targets.length > 0 && <ListFilterItem width="selectWide" label={targetLabel}>
              <Select<string> showSearch={{ optionFilterProp: "label" }} allowClear
                aria-label={targetLabel}
                placeholder={audience === "saas" ? en ? "Choose a tenant" : "选择租户" : en ? "Choose a member" : "选择成员"}
                value={target?.id} options={targets.map(item => ({ value: item.id, label: item.label }))}
                onChange={value => choose("target", value)} />
            </ListFilterItem>}
            <Select<string> aria-label={en ? "Business Core" : "业务 Core"} placeholder={en ? "Choose a Core" : "选择 Core"}
              allowClear value={core?.id} options={cores.map(item => ({ value: item.id, label: item.name }))}
              onChange={value => choose("core", value)} />
          </ListFilterBar>
          {audience === "saas" && core && <CoreDeploymentAdmissionPanel core={core} />}
          {!targets.length ? <Empty description={en ? "No authorized directory entries." : "当前没有可管理的目录对象。"} />
            : !selectionMissing && (target && core ? audience === "saas" ? <CoreTenantGrantPanel tenant={target} core={core} />
              : <CoreMemberAssignmentPanel member={target} core={core} />
              : <p>{en ? "Choose a directory entry and Core to read its current access." : "选择目录对象和 Core 后，读取当前授权状态。"}</p>)}
        </>)}
    </QueryState></>;
}

function TenantDirectory() {
  const { session } = usePlatformApplication(), api = useCoreManagementApi();
  const key = ["public-core-access-directory", session.currentSessionEpoch(), "saas"];
  const tenants = useQuery({ queryKey: [...key, "tenants"], queryFn: ({ signal }) =>
    session.runtime.request<PlatformTenantSummary[]>("/platform/tenants", { signal }), meta: { liveRefresh: false } });
  const cores = useQuery({ queryKey: [...key, "registered"], queryFn: ({ signal }) => api.registered(signal), meta: { liveRefresh: false } });
  return <AccessDirectory audience="saas" cores={cores.data ?? []} targets={(tenants.data ?? []).filter(item => item.tenantCode !== "platform")
    .map(item => ({ id: item.tenantId, name: item.tenantName, label: `${item.tenantName} (${item.tenantCode})`, status: item.tenantStatus }))}
    loading={tenants.isPending || cores.isPending} error={tenants.error || cores.error}
    retry={() => Promise.all([tenants.refetch(), cores.refetch()])} />;
}

function MemberDirectory() {
  const { session } = usePlatformApplication(), context = useCoreSession();
  const members = useQuery({ queryKey: ["public-core-access-directory", session.currentSessionEpoch(), "tenant", "members"],
    queryFn: ({ signal }) => session.runtime.request<SystemUserRow[]>("/platform/users", { signal }),
    enabled: context.data?.canManageMembers === true, meta: { liveRefresh: false } });
  if (context.data && !context.data.canManageMembers) return <Result status="403" title="403" />;
  return <AccessDirectory audience="tenant" cores={context.data?.assignable ?? []} targets={(members.data ?? [])
    .map(item => ({ id: item.id, name: item.displayName, label: `${item.displayName} (${item.account})`, status: item.isActive ? "active" : "disabled" }))}
    loading={context.isPending || !context.error && members.isPending} error={context.error || members.error}
    retry={async () => {
      const current = await context.refetch();
      if (current.isError) throw current.error;
      if (!current.data?.canManageMembers) return;
      const result = await members.refetch();
      if (result.isError) throw result.error;
    }} />;
}

export function CoreAccessPage({ audience }: { audience: "saas" | "tenant" }) {
  const { user, sessionVerified } = useAdminSession();
  if (!sessionVerified || !canManagePublicResource(user, audience, audience === "saas" ? "system:tenant:manage" : "system:user:manage"))
    return <Result status="403" title="403" />;
  return audience === "saas" ? <TenantDirectory /> : <MemberDirectory />;
}

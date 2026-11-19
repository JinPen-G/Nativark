/** 平台开通和租户成员分配的聚焦管理面；目录状态控制新开通，原结果与后续读取分开，原操作引用按对象保留。 */
import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryFilters } from "@tanstack/react-query";
import { ChangeMemberCoreAssignmentSchema, ChangeTenantCoreGrantSchema,
  type ChangeMemberCoreAssignment, type ChangeTenantCoreGrant, type CoreSessionContext, type MemberCoreAssignment, type TenantCoreGrant } from "@rental-os/core-contracts";
import { useAdminSession, useAdminRuntime } from "../runtime";
import { useLocale } from "../app/locale";
import { QueryState } from "../components/QueryState";
import { ActionButton, Alert, ConfirmAction, DataTableStatus, ListSection, Result } from "../components/ui";
import { useCoreManagementApi, coreManagementRejectedBeforeCommit } from "./management-client";
import { UnsavedChangesGuard } from "../components/UnsavedChangesGuard";
import { canManagePublicResource } from "../application-access";

type CoreLabel = { id: string; name: string };
type Target = { id: string; name: string; status?: "active" | "frozen" | "disabled" };
type Panel = { kind: "tenant"; tenant: Target; core: CoreLabel } | { kind: "member"; member: Target; core: CoreLabel };
type Original = { kind: "tenant"; input: ChangeTenantCoreGrant } | { kind: "member"; input: ChangeMemberCoreAssignment };

function verifyReceipt(original: Original, receipt: TenantCoreGrant | MemberCoreAssignment, tenantId: string | undefined): void {
  const expectedTenant = original.kind === "tenant" ? original.input.tenantId : tenantId;
  if (receipt.operationId !== original.input.operationId || receipt.coreId !== original.input.coreId
    || receipt.tenantId !== expectedTenant || receipt.revision !== original.input.expectedRevision + 1
    || receipt.state !== original.input.state || original.kind === "member" && (!("userId" in receipt) || receipt.userId !== original.input.userId))
    throw new Error("原Core管理回执与提交不一致");
}

function storedOperation(key: string, props: Panel): Original | undefined {
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return;
  const input = JSON.parse(raw);
  const original: Original = props.kind === "tenant"
    ? { kind: "tenant", input: ChangeTenantCoreGrantSchema.parse(input) }
    : { kind: "member", input: ChangeMemberCoreAssignmentSchema.parse(input) };
  if (original.input.coreId !== props.core.id || original.kind === "tenant" && props.kind === "tenant" && original.input.tenantId !== props.tenant.id
    || original.kind === "member" && props.kind === "member" && original.input.userId !== props.member.id)
    throw new Error("原Core管理核对编号与当前对象不一致");
  return original;
}

export function CoreTenantGrantPanel({ tenant, core }: { tenant: Target; core: CoreLabel }) {
  return <CoreAccessPanel kind="tenant" tenant={tenant} core={core} />;
}
export function CoreMemberAssignmentPanel({ member, core }: { member: Target; core: CoreLabel }) {
  return <CoreAccessPanel kind="member" member={member} core={core} />;
}

function CoreAccessPanel(props: Panel) {
  const { currentSessionEpoch } = useAdminRuntime();
  const { user, tenant } = useAdminSession();
  const target = props.kind === "tenant" ? props.tenant : props.member;
  const key = JSON.stringify([currentSessionEpoch(), user?.id, tenant?.tenantId, props.kind, target.id, props.core.id]);
  return <CoreAccessEditor key={key} {...props} />;
}

function CoreAccessEditor(props: Panel) {
  const { currentSessionEpoch } = useAdminRuntime(), coreManagementApi = useCoreManagementApi();
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en-US" ? en : zh;
  const { user, tenant, sessionVerified } = useAdminSession();
  const client = useQueryClient();
  const epoch = useRef(currentSessionEpoch()).current;
  const target = props.kind === "tenant" ? props.tenant : props.member;
  const canManage = sessionVerified && canManagePublicResource(user, props.kind === "tenant" ? "saas" : "tenant",
    props.kind === "tenant" ? "system:tenant:manage" : "system:user:manage");
  const targetActive = useRef(true);
  targetActive.current = target.status === undefined || target.status === "active";
  const live = useRef(canManage); live.current = canManage;
  const lifetime = useRef<AbortController | null>(null);
  useLayoutEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const query = useQuery({
    queryKey: ["platform-core-access", currentSessionEpoch(), tenant?.tenantId, user?.id, props.kind, target.id, props.core.id],
    queryFn: async ({ signal }) => props.kind === "tenant"
      ? coreManagementApi.tenantGrant({ tenantId: props.tenant.id, coreId: props.core.id }, signal)
      : coreManagementApi.memberAssignment({ userId: props.member.id, coreId: props.core.id }, signal),
    enabled: canManage, meta: { liveRefresh: false }
  });
  const journalKey = JSON.stringify(["core-management-operation", tenant?.tenantId, user?.id, props.kind, target.id, props.core.id]);
  // 缓存只定位原操作；刷新或重新进入仍先读服务端收据，绝不据此重发或授权。
  const [original, setOriginalState] = useState(() => storedOperation(journalKey, props));
  const originalRef = useRef(original);
  const setOriginal = (value: Original | undefined) => { originalRef.current = value; setOriginalState(value); };
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<"rejected" | "unknown" | "unavailable">();
  const [receipt, setReceipt] = useState<string>();
  const [refreshFailure, setRefreshFailure] = useState(false);
  const needsRefresh = useRef(false), needsDirectory = useRef(false);
  const inFlight = useRef<{ action: string; promise: Promise<void> } | null>(null);
  const controller = () => {
    if (!live.current || currentSessionEpoch() !== epoch || !lifetime.current || lifetime.current.signal.aborted)
      throw new DOMException("原Core管理页面已失效", "AbortError");
    return lifetime.current;
  };
  const readDirectory = async () => {
    controller();
    const affected: QueryFilters = { predicate: cached => {
      const key = cached.queryKey;
      return key[0] === "core" && key[1] === props.core.id
        || ["platform-core-scope", "platform-core-binding"].includes(String(key[0]))
          && key[1] === epoch && key[2] === tenant?.tenantId && key[3] === user?.id && key[4] === props.core.id;
    } };
    const directory = { queryKey: ["platform-core-session", epoch, tenant?.tenantId, user?.id], exact: true };
    // 目录没有缓存时invalidate会复用变更前的请求；先中止，禁止其旧授权回填。
    await client.cancelQueries(directory);
    controller();
    // 只撤去目标Core的旧准入，不从变更收据补权限；其余Core保留到真实目录重读。
    client.setQueryData<CoreSessionContext>(directory.queryKey, context => context && { ...context,
      cores: context.cores.filter(entry => entry.core.id !== props.core.id),
      assignable: props.kind === "tenant" ? context.assignable.filter(core => core.id !== props.core.id) : context.assignable });
    client.removeQueries(affected);
    await client.invalidateQueries(directory, { throwOnError: true });
    controller(); needsDirectory.current = false;
  };
  const readCurrent = async () => {
    const boundary = controller();
    needsRefresh.current = true;
    const reads = [query.refetch().then(result => { if (result.isError) throw result.error; })];
    if (needsDirectory.current) reads.push(readDirectory());
    const outcomes = await Promise.allSettled(reads);
    if (boundary.signal.aborted || currentSessionEpoch() !== epoch || !live.current) return false;
    const refreshed = outcomes.every(result => result.status === "fulfilled");
    needsRefresh.current = !refreshed; setRefreshFailure(!refreshed);
    return refreshed;
  };
  const run = (action: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (inFlight.current) return inFlight.current.action === action ? inFlight.current.promise
      : Promise.reject(new Error(text("请等待当前操作完成", "Wait for the current operation to finish")));
    const boundary = controller();
    setBusy(true);
    const pending = work(boundary.signal).finally(() => {
      if (inFlight.current?.promise === pending) inFlight.current = null;
      if (!boundary.signal.aborted) setBusy(false);
    });
    inFlight.current = { action, promise: pending };
    return pending;
  };
  const retryRead = () => run("read", async () => {
    if (!await readCurrent()) throw new Error(text("最新状态尚不可用，请稍后重新读取", "The latest state is unavailable. Read it again later."));
  });
  const recorded = async (command: Original) => {
    controller(); window.sessionStorage.removeItem(journalKey); setOriginal(undefined); setFailure(undefined); setReceipt(command.input.operationId);
    needsDirectory.current = props.kind === "tenant" ? props.tenant.id === tenant?.tenantId : props.member.id === user?.id;
    // 收据已经确认；随后读取失败单独呈现，不把原变更重新判为unknown或重发。
    await readCurrent();
  };
  const change = (enabling: boolean) => run(enabling ? "enable" : "disable", async signal => {
    if (enabling && !targetActive.current) throw new Error(text("请先恢复租户或成员账号", "Restore the tenant or member account first"));
    if (originalRef.current || needsRefresh.current || !query.data || query.error || query.isFetching) throw new Error(text("请先读取当前状态", "Read the current state first"));
    const fact = query.data.status === "recorded" ? "grant" in query.data ? query.data.grant : query.data.assignment : undefined;
    const command: Original = props.kind === "tenant"
      ? { kind: "tenant", input: { tenantId: props.tenant.id, coreId: props.core.id, state: enabling ? "enabled" : "disabled",
        expectedRevision: fact?.revision ?? 0, operationId: crypto.randomUUID() } }
      : { kind: "member", input: { userId: props.member.id, coreId: props.core.id, state: enabling ? "assigned" : "revoked",
        expectedRevision: fact?.revision ?? 0, operationId: crypto.randomUUID() } };
    // 发送前保存唯一原键；本机无法保存核对引用时不发送变更。
    window.sessionStorage.setItem(journalKey, JSON.stringify(command.input));
    setOriginal(command); setFailure(undefined); setReceipt(undefined);
    try {
      const result = command.kind === "tenant" ? await coreManagementApi.changeTenantGrant(command.input, signal)
        : await coreManagementApi.changeMemberAssignment(command.input, signal);
      verifyReceipt(command, result, tenant?.tenantId);
      controller();
    } catch (error) {
      if (!signal.aborted && live.current) {
        if (coreManagementRejectedBeforeCommit(error)) {
          window.sessionStorage.removeItem(journalKey);
          setOriginal(undefined);
          setFailure("rejected");
          await readCurrent();
        } else setFailure("unknown");
      }
      throw error;
    }
    await recorded(command);
  });
  const reconcile = () => run("original", async signal => {
    const pending = originalRef.current;
    if (!pending) throw new Error(text("没有待核对操作", "No operation is awaiting confirmation"));
    const observed = pending.kind === "tenant"
      ? await coreManagementApi.tenantGrantOperation({ tenantId: pending.input.tenantId, coreId: pending.input.coreId,
        operationId: pending.input.operationId }, signal)
      : await coreManagementApi.memberAssignmentOperation({ userId: pending.input.userId, coreId: pending.input.coreId,
        operationId: pending.input.operationId }, signal);
    controller();
    if (observed.status === "unavailable") {
      setFailure("unavailable");
      throw new Error(text("原结果尚不可用", "The original result is unavailable"));
    }
    const result = "grant" in observed ? observed.grant : observed.assignment;
    verifyReceipt(pending, result, tenant?.tenantId);
    await recorded(pending);
  });
  if (!canManage) return <Result status="403" title={text("无权管理此 Core", "Core management is unavailable")} />;
  const fact = query.data?.status === "recorded" ? "grant" in query.data ? query.data.grant : query.data.assignment : undefined;
  const enabled = fact?.state === "enabled" || fact?.state === "assigned";
  const state = props.kind === "tenant"
    ? text(enabled ? "已开通" : fact ? "已停用" : "尚未开通", enabled ? "Enabled" : fact ? "Disabled" : "Not enabled")
    : text(enabled ? "已分配" : fact ? "已撤回" : "尚未分配", enabled ? "Assigned" : fact ? "Revoked" : "Not assigned");
  const disabled = busy || Boolean(original) || refreshFailure || query.isFetching || Boolean(query.error);
  const failureMessage = failure === "rejected"
    ? text("本次操作被拒绝，请核对当前状态和管理权限。", "The change was rejected. Check the current state and your management access.")
    : failure === "unavailable"
      ? text("尚未读到原操作收据，请保留核对编号并稍后再次核对。", "The original receipt is unavailable. Keep the reference and read it again later.")
      : failure === "unknown" ? text("未能确认本次操作结果，请核对原操作。", "The result is unconfirmed. Read the original operation.") : undefined;
  return <ListSection title={`${props.core.name} · ${target.name}`}>
    <UnsavedChangesGuard busy={busy} dirty={Boolean(original)} />
    {!targetActive.current && <Alert type="warning" title={props.kind === "tenant"
      ? text(target.status === "frozen" ? "租户已冻结" : "租户已停用", target.status === "frozen" ? "The tenant is frozen" : "The tenant is disabled")
      : text("成员账号已停用", "The member account is disabled")}
      description={props.kind === "tenant"
        ? text("原 Core 授权记录保留，恢复租户后按当前权限使用。", "Core access records are retained. Restore the tenant to use its current access.")
        : text("原 Core 分配记录保留，恢复账号后按当前分配与权限使用。", "Core assignment records are retained. Restore the account to use its current assignments and permissions.")} />}
    <QueryState loading={query.isPending} error={query.error} onRetry={retryRead}>
      <DataTableStatus tone={enabled ? "success" : "neutral"}>{state}</DataTableStatus>
      {enabled
        ? <ConfirmAction label={text(props.kind === "tenant" ? "停用 Core" : "撤回分配", props.kind === "tenant" ? "Disable Core" : "Revoke assignment")}
          prompt={text(props.kind === "tenant" ? "停用后保留数据和配置，关闭该租户的普通业务使用。" : "撤回后该成员不能继续使用此 Core，原数据保留。",
            props.kind === "tenant" ? "Data and configuration are retained. Ordinary use by this tenant will close." : "This member will lose Core access. Existing data is retained.")}
          tone="danger" disabled={disabled} onConfirm={() => change(false)} />
        : <ActionButton label={text(props.kind === "tenant" ? "开通 Core" : "分配 Core", props.kind === "tenant" ? "Enable Core" : "Assign Core")}
          intent="confirm" disabled={disabled || !targetActive.current} onAction={() => change(true)} />}
    </QueryState>
    {refreshFailure && <Alert type="warning" title={receipt
      ? text("操作已记录，最新状态尚未读到", "The operation is recorded. The latest state is unavailable.")
      : text("最新状态尚未读到", "The latest state is unavailable.")}
      action={<ActionButton label={text("重新读取", "Read again")} intent="refresh" pending={busy} onAction={retryRead} />} />}
    {failureMessage && !original && <Alert type="error" title={failureMessage} />}
    {original && <>
      <Alert type="warning" title={failureMessage ?? text("本次操作等待核对", "This operation needs confirmation")}
        description={text("请先核对原操作。重新进入本页会保留核对编号。", "Read the original operation first. The reference is retained when you reopen this view.")} />
      <p>{text("核对编号", "Reference")}{" "}<code>{original.input.operationId}</code></p>
      <ActionButton label={text("核对原操作", "Read original operation")} intent="review" pending={busy} onAction={reconcile} />
    </>}
    {receipt && <p>{text("原操作已提交，请以当前状态的最新读取为准。", "The original operation is recorded. Use the latest current-state read.")}</p>}
  </ListSection>;
}

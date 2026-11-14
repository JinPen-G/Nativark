/** 平台开通和租户成员分配的聚焦管理面；当前事实/原收据分开，未知结果只读核对。 */
import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChangeMemberCoreAssignmentSchema, ChangeTenantCoreGrantSchema,
  type ChangeMemberCoreAssignment, type ChangeTenantCoreGrant, type MemberCoreAssignment, type TenantCoreGrant } from "@rental-os/core-contracts";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { currentSessionEpoch } from "@/app/queryClient";
import { QueryState } from "@/components/QueryState";
import { ActionButton, Alert, ConfirmAction, DataTableStatus, ListSection, Result } from "@/components/ui";
import { coreManagementApi, coreManagementRejectedBeforeCommit } from "./management-client";

type CoreLabel = { id: string; name: string };
type Target = { id: string; name: string };
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
  const { user, tenant } = useAuthStore();
  const target = props.kind === "tenant" ? props.tenant : props.member;
  const key = JSON.stringify([currentSessionEpoch(), user?.id, tenant?.tenantId, props.kind, target.id, props.core.id]);
  return <CoreAccessEditor key={key} {...props} />;
}

function CoreAccessEditor(props: Panel) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en-US" ? en : zh;
  const { user, tenant, sessionVerified } = useAuthStore();
  const epoch = useRef(currentSessionEpoch()).current;
  const target = props.kind === "tenant" ? props.tenant : props.member;
  const permissions = user?.permissions ?? [];
  const canManage = sessionVerified && (props.kind === "tenant"
    ? user?.isSaasAdmin === true && (permissions.includes("*") || permissions.includes("system:tenant:manage"))
    : user?.isSaasAdmin !== true && (user?.isPlatformAdmin === true
      || user?.dataScope === "all" && permissions.includes("system:user:manage")));
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
  const inFlight = useRef<Promise<void> | null>(null);
  const controller = () => {
    if (!live.current || currentSessionEpoch() !== epoch || !lifetime.current || lifetime.current.signal.aborted)
      throw new DOMException("原Core管理页面已失效", "AbortError");
    return lifetime.current;
  };
  const readCurrent = () => query.refetch();
  const run = (work: (signal: AbortSignal) => Promise<void>) => {
    if (inFlight.current) return inFlight.current;
    const boundary = controller();
    setBusy(true);
    const pending = work(boundary.signal).finally(() => {
      inFlight.current = null;
      if (!boundary.signal.aborted) setBusy(false);
    });
    inFlight.current = pending;
    return pending;
  };
  const change = (enabling: boolean) => run(async signal => {
    if (originalRef.current || !query.data || query.error || query.isFetching) throw new Error(text("请先读取当前状态", "Read the current state first"));
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
      controller(); window.sessionStorage.removeItem(journalKey); setOriginal(undefined); setReceipt(command.input.operationId);
      await readCurrent();
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
  });
  const reconcile = () => run(async signal => {
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
    window.sessionStorage.removeItem(journalKey); setOriginal(undefined); setFailure(undefined); setReceipt(pending.input.operationId);
    await readCurrent();
  });
  if (!canManage) return <Result status="403" title={text("无权管理此 Core", "Core management is unavailable")} />;
  const fact = query.data?.status === "recorded" ? "grant" in query.data ? query.data.grant : query.data.assignment : undefined;
  const enabled = fact?.state === "enabled" || fact?.state === "assigned";
  const state = props.kind === "tenant"
    ? text(enabled ? "已开通" : fact ? "已停用" : "尚未开通", enabled ? "Enabled" : fact ? "Disabled" : "Not enabled")
    : text(enabled ? "已分配" : fact ? "已撤回" : "尚未分配", enabled ? "Assigned" : fact ? "Revoked" : "Not assigned");
  const disabled = busy || Boolean(original) || query.isFetching || Boolean(query.error);
  const failureMessage = failure === "rejected"
    ? text("本次操作被拒绝，请核对当前状态和管理权限。", "The change was rejected. Check the current state and your management access.")
    : failure === "unavailable"
      ? text("尚未读到原操作收据，请保留核对编号并稍后再次核对。", "The original receipt is unavailable. Keep the reference and read it again later.")
      : failure === "unknown" ? text("未能确认本次操作结果，请核对原操作。", "The result is unconfirmed. Read the original operation.") : undefined;
  return <ListSection title={`${props.core.name} · ${target.name}`}>
    <QueryState loading={query.isPending} error={query.error} onRetry={readCurrent}>
      <DataTableStatus tone={enabled ? "success" : "neutral"}>{state}</DataTableStatus>
      {enabled
        ? <ConfirmAction label={text(props.kind === "tenant" ? "停用 Core" : "撤回分配", props.kind === "tenant" ? "Disable Core" : "Revoke assignment")}
          prompt={text(props.kind === "tenant" ? "停用后保留数据和配置，关闭该租户的普通业务使用。" : "撤回后该成员不能继续使用此 Core，原数据保留。",
            props.kind === "tenant" ? "Data and configuration are retained. Ordinary use by this tenant will close." : "This member will lose Core access. Existing data is retained.")}
          tone="danger" disabled={disabled} onConfirm={() => change(false)} />
        : <ActionButton label={text(props.kind === "tenant" ? "开通 Core" : "分配 Core", props.kind === "tenant" ? "Enable Core" : "Assign Core")}
          intent="confirm" disabled={disabled} onAction={() => change(true)} />}
    </QueryState>
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

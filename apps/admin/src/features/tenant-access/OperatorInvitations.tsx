/** 邮箱邀请宿主。原 UIArc 控制选择与动效，服务器核对账号、授权和投递结果。 */
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusinessWorkspace, InviteTenantOperatorRequest, SaveWorkspaceAccessRequest, SystemRoleRow,
  TenantOperatorInvitationMailPreview, TenantOperatorInvitationRow } from "@rental-os/shared";
import { tenantMessagingApi } from "@/api/tenantMessaging";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { ActionButton, Alert, App, Button, Checkbox, Drawer, Form, Select } from "@/components/ui";
import { InvitePeople, type InviteRecipient, type InviteSelection, type PendingInvite } from "./invitation-source/components/invite-people";
import { DispatchStatus, DISPATCH_STATUS_LABELS } from "@/features/dispatch/DispatchDetail";
import styles from "./OperatorInvitations.module.css";

interface Props { open: boolean; onClose: () => void; roles: SystemRoleRow[]; workspaces: BusinessWorkspace[]; }
const failureMessage = (error: unknown) => (error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
  ?? (error instanceof Error ? error.message : String(error));

export function OperatorInvitations(props: Props) {
  const { t, locale } = useLocale(), { modal } = App.useApp(), cache = useQueryClient();
  const tenant = useAuthStore(state => state.tenant), userId = useAuthStore(state => state.user?.id);
  return <InvitationWorkspace key={`${tenant?.tenantId}:${userId}`} {...props} tenantName={tenant?.tenantName ?? ""} t={t} locale={locale} modal={modal} cache={cache} />;
}

function InvitationWorkspace({ open, onClose, roles, workspaces, tenantName, t, locale, modal, cache }: Props & {
  tenantName: string; t: (text: string) => string; locale: string;
  modal: ReturnType<typeof App.useApp>["modal"]; cache: ReturnType<typeof useQueryClient>;
}) {
  const [selected, setSelected] = useState<InviteSelection[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [accesses, setAccesses] = useState<SaveWorkspaceAccessRequest[]>([]);
  const [preview, setPreview] = useState<TenantOperatorInvitationMailPreview>();
  const [feedback, setFeedback] = useState<string>();
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  // 原请求在窗口关闭后仍保留。未知结果仅核对原键，不重新生成投递操作。
  const attempts = useRef(new Map<string, InviteTenantOperatorRequest>());
  const availableRoles = useMemo(() => roles.filter(role => role.isActive && !role.fixedAllPermissions && role.code !== "TENANT_ADMIN"), [roles]);
  const defaultRole = availableRoles.find(role => role.scope === "store")?.id ?? availableRoles[0]?.id;
  const invitations = useQuery({ queryKey: ["tenant-operator-invitations"], enabled: open, queryFn: tenantMessagingApi.invitations, retry: false });
  const activeWorkspaces = workspaces.filter(workspace => workspace.status === "active");
  const refresh = () => cache.invalidateQueries({ queryKey: ["tenant-operator-invitations"] });
  const asPending = (row: TenantOperatorInvitationRow, role: string): PendingInvite => ({ key: row.id,
    entry: { email: row.email, name: row.displayName }, role, status: row.status === "accepted" ? "joined" : "sent",
    note: t(row.status === "accepted" ? "已加入" : DISPATCH_STATUS_LABELS[row.deliveryStatus]) });
  const payload = (recipient: InviteRecipient): InviteTenantOperatorRequest => {
    if (!accesses.length) throw new Error(t("请选择至少一个经营空间"));
    return { email: recipient.entry.email.trim().toLowerCase(), displayName: recipient.entry.name, roleIds: [recipient.role],
      workspaceAccesses: accesses, idempotencyKey: crypto.randomUUID() };
  };
  const send = async (recipients: readonly InviteRecipient[], { signal }: { signal: AbortSignal }) => {
    if (inFlight.current) throw new Error(t("邀请正在处理中"));
    if (!accesses.length) throw new Error(t("请选择至少一个经营空间"));
    inFlight.current = true;
    setSending(true); setFeedback(undefined);
    const sent: PendingInvite[] = [], failed: Array<{ email: string; message: string }> = [];
    try {
      for (const recipient of recipients) {
        if (signal.aborted) break;
        const email = recipient.entry.email.trim().toLowerCase();
        let submitted = false;
        try {
          const previous = attempts.current.get(email);
          if (previous) {
            const row = await tenantMessagingApi.invitationByKey(previous.idempotencyKey);
            if (row.status !== "pending" && row.status !== "accepted") throw new Error(t("原邀请已结束，请查看邀请记录"));
            if (["sent", "delivered"].includes(row.deliveryStatus) || row.status === "accepted") sent.push(asPending(row, previous.roleIds[0]));
            else failed.push({ email, message: t(DISPATCH_STATUS_LABELS[row.deliveryStatus]) });
            continue;
          }
          const checked = await tenantMessagingApi.checkEmail(email);
          if (checked.exists || checked.pendingInvitation) throw new Error(checked.message ?? t("该邮箱已有账号或待接受邀请，无需发送"));
          if (signal.aborted) break;
          const request = payload(recipient);
          attempts.current.set(email, request);
          submitted = true;
          const row = await tenantMessagingApi.invite(request);
          if (["sent", "delivered"].includes(row.deliveryStatus)) sent.push(asPending(row, recipient.role));
          else failed.push({ email, message: t(DISPATCH_STATUS_LABELS[row.deliveryStatus]) });
        } catch (error) {
          const status = (error as { response?: { status?: number } })?.response?.status;
          const original = attempts.current.get(email);
          // 有确定拒绝响应且原键确认不存在时，可修正字段。网络未知期间始终保留原键。
          if (submitted && original && status && status >= 400) {
            try { await tenantMessagingApi.invitationByKey(original.idempotencyKey); }
            catch (lookupError) {
              if ((lookupError as { response?: { status?: number } })?.response?.status === 404) attempts.current.delete(email);
            }
          }
          failed.push({ email, message: failureMessage(error) });
        }
      }
      setFeedback(failed.map(item => `${item.email} · ${item.message}`).join("\n") || undefined);
      await refresh();
      return { sent, failed };
    } finally { inFlight.current = false; setSending(false); }
  };
  const revoke = (item: PendingInvite) => new Promise<void>((resolve, reject) => {
    modal.confirm({ title: t("撤回这封运营邀请？"), content: t("撤回后原邮件中的加入链接失效。"),
      onOk: async () => { await tenantMessagingApi.revokeInvitation(item.key); attempts.current.delete(item.entry.email.toLowerCase()); await refresh(); resolve(); },
      onCancel: () => reject(new Error(t("已取消"))) });
  });
  const changeAccess = (workspaceId: string, enabled: boolean) => {
    setPreview(undefined);
    setAccesses(previous => enabled ? [...previous, { workspaceId, roleId: defaultRole, dataScope: "store",
      locationScope: { mode: "all", locationIds: [] }, isActive: true }] : previous.filter(row => row.workspaceId !== workspaceId));
  };
  const records = invitations.data ?? [];
  const historicalRoles = records.map(row => ({ value: `history:${row.id}`, label: row.roleNames.join("、"), disabled: true }));
  const currentPending = [...pending.filter(item => !records.some(row => row.id === item.key)),
    ...records.filter(row => row.status === "pending" || row.status === "accepted").map(row => asPending(row, `history:${row.id}`))];
  return <><Drawer title={t("邀请运营用户")} open={open} onClose={() => { if (!sending) onClose(); }} size={720}>
    <div className={styles.host}>
      {invitations.error && <div className={styles.loadFailure}>
        <Alert type="warning" title={t("邀请记录暂时无法读取")} description={failureMessage(invitations.error)} />
        <ActionButton label={t("重新加载")} variant="secondary" pending={invitations.isFetching}
          onAction={() => invitations.refetch({ throwOnError: true })} />
      </div>}
      <InvitePeople demo={false} sampleList={false} showSeats={false} showTeam={false} canResend={false} directory={[]} team={[]}
        title={t("邀请协作成员")} subtitle={t("通过邮件加入租户，接受后启用账号与经营空间权限。")}
        placeholder={t("输入邮箱，按 Enter 添加")} workspaceName={tenantName} defaultRole={defaultRole}
        roles={[...availableRoles.map(role => ({ value: role.id, label: role.name })), ...historicalRoles]}
        selected={selected} onSelectedChange={value => { setSelected(value); setPreview(undefined); }} pending={currentPending} onPendingChange={setPending}
        disabled={!defaultRole} sendDisabled={!accesses.length || invitations.isError || invitations.isLoading} onSend={send} onRevoke={revoke}
        onError={error => setFeedback(error.message)}
        footerSlot={<ActionButton className={styles.previewAction} label={t("预览邀请邮件")} variant="secondary" disabled={sending || !accesses.length || !selected.some(row => row.kind === "ok")}
          onAction={async () => {
            const first = selected.find((row): row is InviteRecipient => row.kind === "ok");
            if (first) setPreview(await tenantMessagingApi.invitationPreview(payload(first)));
          }} />}
        configurationSlot={<div className={styles.configuration}>
          <h3>{t("经营空间授权")}</h3>
          <p>{t("逐人角色作为租户基础角色；下方空间授权应用于本批邀请。可在账号加入后细化地点权限。")}</p>
          {activeWorkspaces.map(workspace => {
            const access = accesses.find(row => row.workspaceId === workspace.id);
            return <div key={workspace.id} className={styles.access}>
              <Checkbox disabled={sending} checked={Boolean(access)} onChange={event => changeAccess(workspace.id, event.target.checked)}>{workspace.name}</Checkbox>
              {access && <Form layout="vertical" className={styles.accessFields}>
                <Form.Item label={t("空间角色（操作权限）")} htmlFor={`invitation-role-${workspace.id}`}><Select id={`invitation-role-${workspace.id}`} disabled={sending} value={access.roleId}
                  options={availableRoles.map(role => ({ value: role.id, label: role.name }))}
                  onChange={roleId => { setAccesses(rows => rows.map(row => row.workspaceId === workspace.id ? { ...row, roleId } : row)); setPreview(undefined); }} /></Form.Item>
                <Form.Item label={t("数据范围")} htmlFor={`invitation-scope-${workspace.id}`}><Select id={`invitation-scope-${workspace.id}`} disabled={sending} value={access.dataScope}
                  options={[{ value: "store", label: t("当前空间全部数据") }, { value: "own", label: t("仅本人") }]}
                  onChange={dataScope => { setAccesses(rows => rows.map(row => row.workspaceId === workspace.id ? { ...row, dataScope } : row)); setPreview(undefined); }} /></Form.Item>
              </Form>}
            </div>;
          })}
          {!accesses.length && <p role="status">{t("请选择至少一个经营空间")}</p>}
          {feedback && <Alert type="warning" title={t("邀请处理结果")} description={feedback} />}
        </div>} />
      {records.length > 0 && <div className={styles.records}>
        <div className={styles.recordsHeading}><h3>{t("邀请记录")}</h3><Button type="text" disabled={invitations.isFetching} onClick={() => { void refresh(); }}>{t("刷新")}</Button></div>
        {records.map(row => <div key={row.id} className={styles.record}><div><strong>{row.displayName}</strong><span>{row.email}</span>
          <small>{row.workspaceNames.join("、")} · {new Date(row.createdAt).toLocaleString(locale)}</small></div>
          <div><span>{t(({ pending: "待接受", accepted: "已加入", revoked: "已撤回", expired: "已过期" })[row.status])}</span><DispatchStatus value={row.deliveryStatus} /></div></div>)}
      </div>}
    </div>
  </Drawer>
    <Drawer title={t("邀请邮件预览")} open={open && Boolean(preview)} onClose={() => setPreview(undefined)} size={640} zIndex={1100} destroyOnHidden>
      {preview && <div className={styles.preview}>
        <h3>{preview.subject}</h3>
        <iframe className={styles.email} title={t("邀请邮件预览")} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.renderedHtml} />
      </div>}
    </Drawer>
  </>;
}

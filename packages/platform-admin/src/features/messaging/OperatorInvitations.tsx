/** 公共邮箱邀请复用原 UIArc 控制选择，宿主通过受控插槽提供所属 Core 的业务范围。 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InviteTenantOperatorRequest,
  OrganizationSummary,
  SaveWorkspaceAccessRequest,
  SystemRoleRow,
  TenantOperatorInvitationMailPreview,
  TenantOperatorInvitationRow
} from "@rental-os/platform-contracts";
import { useLocale } from "../../app/locale";
import { useAdminRuntime, useAdminSession, type AdminRuntime } from "../../runtime";
import { ActionButton, Alert, App, Button, Drawer, Form, Select } from "../../components/ui";
import { InvitePeople, type InviteRecipient, type InviteSelection, type PendingInvite } from "./invitation-source/components/invite-people";
import { DispatchStatus, DISPATCH_STATUS_LABELS } from "./DispatchDetail";
import { useTenantMessagingApi } from "./client";
import { hasTenantMessagingPermission } from "./messagingAccess";
import styles from "./OperatorInvitations.module.css";

export interface InvitationBusinessAccessProps {
  accesses: SaveWorkspaceAccessRequest[];
  onChange: (accesses: SaveWorkspaceAccessRequest[]) => void;
  roles: SystemRoleRow[];
  defaultRole?: string;
  disabled: boolean;
  classNames: { row: string; fields: string };
}

export interface OperatorInvitationsProps {
  open: boolean;
  onClose: () => void;
  roles: SystemRoleRow[];
  organizations?: OrganizationSummary[];
  businessAccess?: {
    render: (props: InvitationBusinessAccessProps) => ReactNode;
    requiredMessage: string;
  };
  subtitle?: string;
  title?: string;
  revokeTitle?: string;
}

const failureMessage = (error: unknown) => (error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
  ?? (error instanceof Error ? error.message : String(error));

type InvitationAttempts = Map<string, InviteTenantOperatorRequest>;
const invitationAttemptsByRuntime = new WeakMap<AdminRuntime, Map<string, InvitationAttempts>>();

export function OperatorInvitations(props: OperatorInvitationsProps) {
  const { tenant, user } = useAdminSession();
  return <InvitationWorkspace key={`${tenant?.tenantId}:${user?.id}`} {...props} />;
}

function InvitationWorkspace({ open, onClose, roles, organizations, businessAccess, subtitle, title = "邀请协作成员", revokeTitle = "撤回这封成员邀请？" }: OperatorInvitationsProps) {
  const { t, locale } = useLocale();
  const { modal } = App.useApp();
  const cache = useQueryClient();
  const runtime = useAdminRuntime();
  const { tenant, user, sessionVerified } = useAdminSession();
  const api = useTenantMessagingApi();
  const epoch = runtime.currentSessionEpoch();
  const allowed = sessionVerified && hasTenantMessagingPermission(user, "system:user:manage");
  const isCurrent = () => runtime.currentSessionEpoch() === epoch
    && runtime.getSession().sessionVerified
    && hasTenantMessagingPermission(runtime.getSession().user, "system:user:manage");
  const [selected, setSelected] = useState<InviteSelection[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [accesses, setAccesses] = useState<SaveWorkspaceAccessRequest[]>([]);
  const [organizationId, setOrganizationId] = useState<string>();
  const [preview, setPreview] = useState<TenantOperatorInvitationMailPreview>();
  const [feedback, setFeedback] = useState<string>();
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const previewRevision = useRef(0);
  // 宿主按会话代次重挂载路由，原请求须独立保留。租户和账号分别隔离，结果待核对时只读取原键。
  const attempts = useMemo(() => {
    let owners = invitationAttemptsByRuntime.get(runtime);
    if (!owners) {
      owners = new Map();
      invitationAttemptsByRuntime.set(runtime, owners);
    }
    const owner = JSON.stringify([tenant?.tenantId, user?.id]);
    let requests = owners.get(owner);
    if (!requests) {
      requests = new Map();
      owners.set(owner, requests);
    }
    return requests;
  }, [runtime, tenant?.tenantId, user?.id]);
  const availableRoles = useMemo(() => roles.filter(role => role.isActive && !role.fixedAllPermissions && role.code !== "TENANT_ADMIN"), [roles]);
  const defaultRole = availableRoles.find(role => role.scope === "store")?.id ?? availableRoles[0]?.id;
  const missingBusinessAccess = Boolean(businessAccess && !accesses.length);
  const invitationKey = ["tenant-operator-invitations", epoch];
  const invitations = useQuery({ queryKey: invitationKey, enabled: open && allowed,
    queryFn: ({ signal }) => api.invitations(signal), retry: false });
  const refresh = () => isCurrent() ? cache.invalidateQueries({ queryKey: invitationKey }) : Promise.resolve();

  function clearPreview() {
    previewRevision.current += 1;
    setPreview(undefined);
  }

  const asPending = (row: TenantOperatorInvitationRow, role: string): PendingInvite => ({ key: row.id,
    entry: { email: row.email, name: row.displayName }, role, status: row.status === "accepted" ? "joined" : "sent",
    note: t(row.status === "accepted" ? "已加入" : DISPATCH_STATUS_LABELS[row.deliveryStatus]) });
  const payload = (recipient: InviteRecipient): InviteTenantOperatorRequest => {
    if (missingBusinessAccess) throw new Error(businessAccess!.requiredMessage);
    return { email: recipient.entry.email.trim().toLowerCase(), displayName: recipient.entry.name, organizationId, roleIds: [recipient.role],
      workspaceAccesses: businessAccess ? accesses : [], idempotencyKey: crypto.randomUUID() };
  };

  const send = async (recipients: readonly InviteRecipient[], { signal }: { signal: AbortSignal }) => {
    if (!isCurrent()) throw new Error(t("当前没有人员管理权限"));
    if (inFlight.current) throw new Error(t("邀请正在处理中"));
    if (missingBusinessAccess) throw new Error(businessAccess!.requiredMessage);
    inFlight.current = true;
    setSending(true);
    setFeedback(undefined);
    const sent: PendingInvite[] = [];
    const failed: Array<{ email: string; message: string }> = [];
    try {
      for (const recipient of recipients) {
        if (signal.aborted || !isCurrent()) break;
        const email = recipient.entry.email.trim().toLowerCase();
        let submitted = false;
        try {
          const previous = attempts.get(email);
          if (previous) {
            const row = await api.invitationByKey(previous.idempotencyKey);
            if (row.status !== "pending" && row.status !== "accepted") throw new Error(t("原邀请已结束，请查看邀请记录"));
            if (["sent", "delivered"].includes(row.deliveryStatus) || row.status === "accepted") sent.push(asPending(row, previous.roleIds[0]));
            else failed.push({ email, message: t(DISPATCH_STATUS_LABELS[row.deliveryStatus]) });
            continue;
          }
          const checked = await api.checkEmail(email);
          if (checked.exists || checked.pendingInvitation) throw new Error(checked.message ?? t("该邮箱已有账号或待接受邀请，无需发送"));
          if (signal.aborted || !isCurrent()) break;
          const request = payload(recipient);
          attempts.set(email, request);
          submitted = true;
          const row = await api.invite(request);
          if (["sent", "delivered"].includes(row.deliveryStatus)) sent.push(asPending(row, recipient.role));
          else failed.push({ email, message: t(DISPATCH_STATUS_LABELS[row.deliveryStatus]) });
        } catch (error) {
          const status = (error as { response?: { status?: number } })?.response?.status;
          const original = attempts.get(email);
          // 4xx 确定拒绝且原键不存在才释放尝试，超时与 5xx 继续保留原键。
          if (submitted && original && status && status >= 400 && status < 500 && status !== 408 && isCurrent()) {
            try { await api.invitationByKey(original.idempotencyKey); }
            catch (lookupError) {
              if ((lookupError as { response?: { status?: number } })?.response?.status === 404) attempts.delete(email);
            }
          }
          failed.push({ email, message: failureMessage(error) });
        }
      }
      if (isCurrent()) setFeedback(failed.map(item => `${item.email} · ${item.message}`).join("\n") || undefined);
      await refresh();
      return { sent, failed };
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const revoke = (item: PendingInvite) => new Promise<void>((resolve, reject) => {
    modal.confirm({ title: t(revokeTitle), content: t("撤回后原邮件中的加入链接失效。"),
      onOk: async () => {
        if (!isCurrent()) throw new Error(t("当前没有人员管理权限"));
        await api.revokeInvitation(item.key);
        attempts.delete(item.entry.email.toLowerCase());
        await refresh();
        resolve();
      },
      onCancel: () => reject(new Error(t("已取消"))) });
  });
  const records = invitations.data ?? [];
  const historicalRoles = records.map(row => ({ value: `history:${row.id}`, label: row.roleNames.join("、"), disabled: true }));
  const currentPending = [...pending.filter(item => !records.some(row => row.id === item.key)),
    ...records.filter(row => row.status === "pending" || row.status === "accepted").map(row => asPending(row, `history:${row.id}`))];

  return <><Drawer title={t(title)} open={open} onClose={() => { if (!sending) onClose(); }} size={720}>
    <div className={styles.host}>
      {invitations.error && <div className={styles.loadFailure}>
        <Alert type="warning" title={t("邀请记录暂时无法读取")} description={failureMessage(invitations.error)} />
        <ActionButton label={t("重新加载")} variant="secondary" pending={invitations.isFetching}
          onAction={() => invitations.refetch({ throwOnError: true })} />
      </div>}
      <InvitePeople demo={false} sampleList={false} showSeats={false} showTeam={false} canResend={false} directory={[]} team={[]}
        title={t("邀请协作成员")} subtitle={subtitle ?? t("通过邮件加入租户，接受后启用账号与基础成员授权。")}
        placeholder={t("输入邮箱，按 Enter 添加")} workspaceName={tenant?.tenantName ?? ""} defaultRole={defaultRole}
        roles={[...availableRoles.map(role => ({ value: role.id, label: role.name })), ...historicalRoles]}
        selected={selected} onSelectedChange={value => { setSelected(value); clearPreview(); }} pending={currentPending} onPendingChange={setPending}
        disabled={!allowed || !defaultRole} sendDisabled={missingBusinessAccess || invitations.isError || invitations.isLoading}
        onSend={send} onRevoke={revoke} onError={error => setFeedback(error.message)}
        footerSlot={<ActionButton className={styles.previewAction} label={t("预览邀请邮件")} variant="secondary"
          disabled={!allowed || sending || missingBusinessAccess || !selected.some(row => row.kind === "ok")}
          onAction={async () => {
            const first = selected.find((row): row is InviteRecipient => row.kind === "ok");
            if (!isCurrent()) throw new Error(t("当前没有人员管理权限"));
            if (!first) return;
            const revision = previewRevision.current;
            const result = await api.invitationPreview(payload(first));
            if (isCurrent() && previewRevision.current === revision) setPreview(result);
          }} />}
        configurationSlot={<div className={styles.configuration}>
          {organizations && <Form layout="vertical">
            <Form.Item label={t("归属组织")} htmlFor="invitation-organization"><Select id="invitation-organization" allowClear
              disabled={!allowed || sending} value={organizationId}
              options={organizations.filter(item => item.status === "enabled").map(item => ({ value: item.id, label: item.name }))}
              onChange={value => { setOrganizationId(value); clearPreview(); }} /></Form.Item>
          </Form>}
          {businessAccess?.render({ accesses, onChange: value => { setAccesses(value); clearPreview(); }, roles: availableRoles,
            defaultRole, disabled: !allowed || sending, classNames: { row: styles.access, fields: styles.accessFields } })}
          {missingBusinessAccess && <p role="status">{businessAccess!.requiredMessage}</p>}
          {feedback && <Alert type="warning" title={t("邀请处理结果")} description={feedback} />}
        </div>} />
      {records.length > 0 && <div className={styles.records}>
        <div className={styles.recordsHeading}><h3>{t("邀请记录")}</h3><Button type="text" disabled={invitations.isFetching}
          onClick={() => { void refresh(); }}>{t("刷新")}</Button></div>
        {records.map(row => <div key={row.id} className={styles.record}><div><strong>{row.displayName}</strong><span>{row.email}</span>
          <small>{row.workspaceNames.join("、")} · {new Date(row.createdAt).toLocaleString(locale)}</small></div>
          <div><span>{t(({ pending: "待接受", accepted: "已加入", revoked: "已撤回", expired: "已过期" })[row.status])}</span>
            <DispatchStatus value={row.deliveryStatus} /></div></div>)}
      </div>}
    </div>
  </Drawer>
    <Drawer title={t("邀请邮件预览")} open={open && Boolean(preview)} onClose={clearPreview} size={640} zIndex={1100} destroyOnHidden>
      {preview && <div className={styles.preview}><h3>{preview.subject}</h3>
        <iframe className={styles.email} title={t("邀请邮件预览")} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.renderedHtml} />
      </div>}
    </Drawer>
  </>;
}

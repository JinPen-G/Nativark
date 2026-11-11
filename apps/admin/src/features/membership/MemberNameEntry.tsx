/** Personal member entry into the existing name workflow. The master ID binds
 * view lifetime and the original service query, never business authority.
 * Closing never clears the workflow's pending-operation journal. */
import { useEffect, useRef } from "react";
import { Modal } from "@/components/ui";
import { currentSessionEpoch, currentSessionSignal } from "@/app/queryClient";
import { useAuthStore } from "@/features/auth/authStore";
import { MemberNameFlow } from "@/features/ai-native/MemberNameFlow";
import { useAiManagementLocale } from "@/features/ai-native/management-locale";

type Auth = ReturnType<typeof useAuthStore.getState>;
const permission = "rental-os:member:manage";
const scope = (auth: Auth) => JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId,
  auth.user?.id, auth.user?.isSaasAdmin, auth.user?.isPlatformAdmin, auth.user?.organizationId,
  auth.user?.dataScope, auth.user?.locationScope,
  auth.user?.permissions && [...new Set(auth.user.permissions)].sort(), auth.user?.tenantMembership]);
const available = (auth: Auth) => Boolean(auth.tenant?.tenantId && auth.currentWorkspaceId
  && auth.user?.id && !auth.user.isSaasAdmin && auth.hasTenantMembershipPermission(permission));

export type MemberNameEntryReference = Readonly<{ customerId: string; scope: string; epoch: number }>;
/** This is an in-memory view reference, never a business or authorization key. */
export function memberNameEntryReference(customerId: string): MemberNameEntryReference {
  const auth = useAuthStore.getState();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(customerId) || !available(auth)) throw Error("AI_ACCESS_DENIED");
  return Object.freeze({ customerId, scope: scope(auth), epoch: currentSessionEpoch() });
}

export function MemberNameEntry({ reference, open, onClose, afterClose }: {
  reference?: MemberNameEntryReference; open: boolean; onClose(): void; afterClose(): void;
}) {
  const auth = useAuthStore(), { t } = useAiManagementLocale();
  const foreground = typeof document !== "undefined" && !document.hidden;
  const allowed = Boolean(reference && reference.scope === scope(auth)
    && reference.epoch === currentSessionEpoch() && available(auth));
  const owner = useRef({ reference, open, allowed }); owner.current = { reference, open, allowed };
  const live = useRef(false), closeRef = useRef(onClose); closeRef.current = onClose;
  if (!open || !allowed || !foreground) live.current = false;
  const close = () => { live.current = false; closeRef.current(); };
  useEffect(() => {
    if (!open) return;
    if (!allowed || !foreground) { closeRef.current(); return; }
    live.current = true;
    const signal = currentSessionSignal();
    const retract = () => { live.current = false; closeRef.current(); };
    const visibility = () => { if (document.hidden) retract(); };
    document.addEventListener("visibilitychange", visibility);
    signal.addEventListener("abort", retract, { once: true });
    return () => {
      live.current = false;
      document.removeEventListener("visibilitychange", visibility);
      signal.removeEventListener("abort", retract);
    };
  }, [reference, open, allowed, foreground]);
  const current = () => Boolean(live.current && owner.current.open && owner.current.allowed
    && owner.current.reference === reference && reference && !document.hidden
    && reference.epoch === currentSessionEpoch() && reference.scope === scope(useAuthStore.getState())
    && available(useAuthStore.getState()) && !currentSessionSignal().aborted);
  const identity = JSON.stringify([reference?.scope, reference?.customerId, reference?.epoch]);
  return <Modal presentation="side" title={t("会员姓名修改")} open={open && allowed && foreground}
    onCancel={close} afterClose={afterClose} destroyOnHidden footer={null}>
    {open && allowed && foreground && reference && <MemberNameFlow key={identity}
      customerId={reference.customerId} identity={identity} current={current} onAccessDenied={close} />}
  </Modal>;
}

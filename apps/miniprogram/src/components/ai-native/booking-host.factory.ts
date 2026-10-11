import type { AiClientHostCapabilities } from "@rental-os/shared";
import type { CustomerBookingHost } from "./booking-handoff";
import { readBookingHostCapabilities, readBookingHandoff } from "../../api/orders";
import { PUBLIC_CONFIG } from "../../config/public";
import { serverNow } from "../../core/clock";
import { contextVersion, currentSession, sessionEvents } from "../../core/session";

type Publication = Pick<AiClientHostCapabilities, "tenantCode" | "serviceCode" | "scope" | "releaseRevision">;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);

export function createCustomerBookingHostFactory(publication: Publication | null = null) {
  const expected = publication ? { ...publication, scope: { ...publication.scope } } : null;
  let closed = false, started = false;
  let unsubscribe: (() => void) | undefined;
  const dispose = () => {
    closed = true; unsubscribe?.(); unsubscribe = undefined;
    if (typeof wx.offAppHide === "function") wx.offAppHide(dispose);
  };
  return Object.freeze({
    dispose, hide: dispose,
    async openFromUser(handoffRef: string): Promise<CustomerBookingHost | null> {
      if (closed || started || !expected || !validId(handoffRef)
        || ![expected.tenantCode, expected.serviceCode, expected.scope.tenantId, expected.scope.workspaceId, expected.releaseRevision].every(validId)
        || expected.scope.kind !== "workspace" || PUBLIC_CONFIG.tenantCode !== expected.tenantCode) return null;
      started = true;
      const session = currentSession(), version = contextVersion();
      if (!session?.accessToken || session.customer.customerType !== "personal" || session.serviceCode !== expected.serviceCode) { dispose(); return null; }
      const customerId = session.customer.customerId, token = session.accessToken;
      let expiresAt = Number.POSITIVE_INFINITY;
      const current = () => {
        const latest = currentSession();
        const valid = !closed && contextVersion() === version && latest === session && latest.accessToken === token
          && latest.customer.customerId === customerId && latest.customer.customerType === "personal"
          && latest.serviceCode === expected.serviceCode && PUBLIC_CONFIG.tenantCode === expected.tenantCode && serverNow() < expiresAt;
        if (!valid) dispose();
        return valid;
      };
      unsubscribe = sessionEvents.on(dispose);
      if (typeof wx.onAppHide === "function") wx.onAppHide(dispose);
      const validate = (value: AiClientHostCapabilities) => {
        const end = Date.parse(value?.expiresAt), observed = Date.parse(value?.observedAt);
        if (!current() || !value || JSON.stringify(value).length > 8192 || value.contractVersion !== "ain-client-host-capabilities-1"
          || value.enabled !== true || value.audience !== "customer" || value.surface !== "client_miniprogram" || value.channel !== "wechat_miniprogram"
          || value.customerType !== "personal" || value.customerId !== customerId || value.tenantCode !== expected.tenantCode
          || value.serviceCode !== expected.serviceCode || value.scope?.kind !== "workspace"
          || value.scope.tenantId !== expected.scope.tenantId || value.scope.workspaceId !== expected.scope.workspaceId
          || value.releaseRevision !== expected.releaseRevision || value.policy?.allowRead !== true || value.policy.allowCreate !== true
          || !Number.isSafeInteger(value.policy.revision) || value.policy.revision < 1 || value.policy.revision > 4294967294
          || !Number.isFinite(end) || !Number.isFinite(observed) || end <= observed || end <= serverNow()
          || value.authorization !== "observation_only_recheck_each_action" || value.capabilities?.bookingDrafts !== true
          || typeof value.capabilities.savedDeliveryAddresses !== "boolean" || !Array.isArray(value.capabilities.entryActions)
          || value.capabilities.entryActions.length > 3 || new Set(value.capabilities.entryActions).size !== value.capabilities.entryActions.length
          || value.capabilities.entryActions.some(action => !["OPEN_ORDER", "CREATE_BOOKING_DRAFT", "OPEN_BOOKING"].includes(action))
          || !value.capabilities.entryActions.includes("OPEN_BOOKING") || !value.capabilities.entryActions.includes("CREATE_BOOKING_DRAFT")) throw Error("booking_host_unavailable");
        return value;
      };
      try {
        const initial = validate(await readBookingHostCapabilities());
        expiresAt = Date.parse(initial.expiresAt);
        const policyRevision = initial.policy.revision;
        const recheck = async () => {
          if (!current()) throw Error("booking_host_unavailable");
          const value = validate(await readBookingHostCapabilities());
          if (value.policy.revision !== policyRevision) throw Error("booking_host_changed");
          expiresAt = Math.min(expiresAt, Date.parse(value.expiresAt));
          if (!current()) throw Error("booking_host_unavailable");
        };
        return Object.freeze({
          get enabled() { return current(); }, handoffRef,
          capability: Object.freeze({ tenantCode: expected.tenantCode, serviceCode: expected.serviceCode, customerId,
            tenantId: expected.scope.tenantId, workspaceId: expected.scope.workspaceId, releaseRevision: expected.releaseRevision }),
          isCurrent: current, dispose,
          async readBookingHandoff(input: { handoffRef: string }) {
            try {
              if (input.handoffRef !== handoffRef) throw Error("booking_host_reference_changed");
              await recheck();
              const handoff = await readBookingHandoff(handoffRef);
              await recheck();
              return handoff;
            } catch { dispose(); throw Error("booking_host_unavailable"); }
          }
        });
      } catch { dispose(); return null; }
    }
  });
}

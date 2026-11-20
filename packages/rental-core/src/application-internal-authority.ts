/** 服务端原 Guard 的隔离复验回到同一个已绑定请求；不创建身份、选择另一应用或扩大动作权限。
 * 宿主在原 application-access 绑定后登记，内部调用仅在真实 Guard 成功后消费一次桥票据。 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ForbiddenException } from "@nestjs/common";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { hasRentalBusinessTenantFence } from "./mysql-business-fence";

type Identity = NonNullable<ReturnType<typeof getRequestIdentity>>;
interface InternalAuthorityScope {
  active: boolean;
  source: Identity;
  fingerprint: string;
  assertCurrent(): void;
  restore?<T>(consume: () => Promise<T>): Promise<T>;
}
const scopes = new AsyncLocalStorage<InternalAuthorityScope>();
const denied = () => new ForbiddenException("内部业务调用缺少同一有效请求的原 Guard 复验");

function fingerprint(identity: Identity | undefined, requireMember = true): string {
  const session = identity?.accessSession, location = identity?.locationScope;
  if (!identity) throw denied();
  if (requireMember && (!identity.tenantId || !identity.userId || !identity.workspaceId || identity.isSaasAdmin !== false
    || !["staff", "operator"].includes(identity.audience ?? "")
    || Boolean(identity.staffApi) !== (identity.audience === "staff")
    || !session?.sessionId || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now() / 1000
    || !Array.isArray(identity.permissions) || !identity.permissions.every(value => typeof value === "string")
    || !["all", "organization", "store", "own"].includes(identity.dataScope ?? "")
    || !location || !["all", "selected"].includes(location.mode) || !Array.isArray(location.locationIds))) throw denied();
  return JSON.stringify({ tenantId: identity.tenantId, userId: identity.userId, workspaceId: identity.workspaceId,
    audience: identity.audience, accessSession: session, isSaasAdmin: identity.isSaasAdmin,
    isPlatformAdmin: Boolean(identity.isPlatformAdmin), staffApi: Boolean(identity.staffApi),
    permissions: identity.permissions && [...identity.permissions].sort(), dataScope: identity.dataScope, organizationId: identity.organizationId,
    locationScope: location && { mode: location.mode, locationIds: [...location.locationIds].sort() },
    staffLocationScope: identity.staffLocationScope && { mode: identity.staffLocationScope.mode,
      locationIds: [...identity.staffLocationScope.locationIds].sort() } });
}

/** One instance per application-access owner. assertCurrent must check its captured
 * request/actor/store, not accept an identity supplied by an internal caller. */
export function createRentalInternalAuthorityScope(assertCurrent: () => void) {
  if (typeof assertCurrent !== "function") throw denied();
  return Object.freeze({
    async run<T>(consume: () => Promise<T>): Promise<T> {
      if (!hasRentalBusinessTenantFence() || scopes.getStore()) throw denied();
      assertCurrent();
      const source = getRequestIdentity();
      if (!source) throw denied();
      const scope: InternalAuthorityScope = { active: true, source, fingerprint: fingerprint(source, false), assertCurrent };
      return scopes.run(scope, async () => {
        // Capture the actual ALS stores, including this scope. No copied identity
        // is entered when a verified internal read returns to its owning request.
        const restore = AsyncLocalStorage.snapshot();
        scope.restore = consume => restore(consume);
        try { return await consume(); }
        finally { scope.active = false; scope.restore = undefined; }
      });
    }
  });
}

/** Called before the original isolated Guard pass; runVerified is consumed directly
 * after that Guard has populated its own fresh store. Legacy hosts have no bridge. */
export function captureRentalInternalAuthority() {
  const scope = scopes.getStore();
  if (!scope) {
    if (hasRentalBusinessTenantFence()) throw denied();
    return undefined;
  }
  if (!scope.active || !scope.restore || getRequestIdentity() !== scope.source
    || fingerprint(scope.source) !== scope.fingerprint) throw denied();
  scope.assertCurrent();
  // 捕获当前已验证的完整上下文，保留稍后建立的原任务/事务参加者。
  // 只回到这个同源 store；不能恢复 Guard 之前复制或新建的身份投影。
  const restoreCurrent = AsyncLocalStorage.snapshot();
  let used = false;
  return Object.freeze({
    async runVerified<T>(consume: () => Promise<T>): Promise<T> {
      const verified = getRequestIdentity();
      if (used || !scope.active || !scope.restore || scopes.getStore() !== scope
        || verified === scope.source || fingerprint(verified) !== scope.fingerprint) throw denied();
      used = true;
      return restoreCurrent(async () => {
        if (!scope.active || getRequestIdentity() !== scope.source || fingerprint(scope.source) !== scope.fingerprint) throw denied();
        scope.assertCurrent();
        return consume();
      });
    }
  });
}

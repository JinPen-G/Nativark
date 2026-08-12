import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestIdentity {
  tenantId: string;
  userId: string;
  isSaasAdmin: boolean;
}

const requestIdentityStorage = new AsyncLocalStorage<RequestIdentity>();

export function enterRequestIdentity(identity: RequestIdentity) {
  requestIdentityStorage.enterWith(identity);
}

export function getRequestIdentity() {
  return requestIdentityStorage.getStore();
}

export function getRequestTenantId(fallback = "tenant_001") {
  return requestIdentityStorage.getStore()?.tenantId ?? fallback;
}

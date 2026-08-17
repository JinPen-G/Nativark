import { AsyncLocalStorage } from "node:async_hooks";
import { ForbiddenException } from "@nestjs/common";

export interface RequestIdentity {
  tenantId: string;
  userId: string;
  isSaasAdmin: boolean;
}

// 存储类型允许字段缺失：中间件先建立空上下文，守卫认证后才补全，
// 类型上必须能表达“尚未认证”，避免依赖类型断言掩盖未认证状态。
type RequestIdentityStore = Partial<RequestIdentity>;

const requestIdentityStorage = new AsyncLocalStorage<RequestIdentityStore>();

// 请求入口中间件：用 ALS.run 建立贯穿整条请求链的上下文。
// 守卫中的 enterWith 在部分执行链上不会传播到 controller，曾导致仓储层
// 静默回退演示租户，形成跨租户数据泄露；此处是根因修复。
export function requestIdentityMiddleware(_req: unknown, _res: unknown, next: () => void) {
  requestIdentityStorage.run({}, next);
}

export function enterRequestIdentity(identity: RequestIdentity) {
  const store = requestIdentityStorage.getStore();
  if (store) {
    Object.assign(store, identity);
    return;
  }
  requestIdentityStorage.enterWith(identity);
}

export function getRequestIdentity(): RequestIdentityStore | undefined {
  return requestIdentityStorage.getStore();
}

// 测试、Seed 和后台任务显式建立租户上下文的入口，等价于请求中间件建立的存储。
export function runWithRequestIdentity<T>(identity: RequestIdentityStore, fn: () => T): T {
  return requestIdentityStorage.run({ ...identity }, fn);
}

// 可选读取：调用方需要自行处理未认证（undefined）的情况。
export function getRequestTenantId(): string | undefined {
  return requestIdentityStorage.getStore()?.tenantId;
}

// fail-closed：租户业务仓储的唯一取值入口。缺少已验证租户身份时直接拒绝，
// 禁止任何默认租户回退。
export function requireRequestTenantId(): string {
  const tenantId = requestIdentityStorage.getStore()?.tenantId;
  if (!tenantId) {
    throw new ForbiddenException("缺少已验证的租户身份，拒绝访问");
  }
  return tenantId;
}

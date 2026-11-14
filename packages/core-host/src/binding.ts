/**
 * 受权Core范围的首次绑定和原初始化收据。Core写入、绑定、原操作及审计同事务提交。
 * 原绑定再次进入时直接复用，配置变更由Core自己的业务接口办理。
 */
import { createHash, randomUUID } from "node:crypto";
import {
  BindCoreScopeSchema, CoreBindingOperationQuerySchema, CoreBindingSchema, CoreOperationReferenceSchema,
  isCoreVersionSupported, type CoreBinding, type CoreOperationReference, type CorePrincipal,
  type CoreScopeReference, type CoreServerRegistration, type CoreTransaction
} from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeploymentAvailability } from "./access";

export interface CoreBindingReceipt {
  actor: CorePrincipal;
  fingerprint: string;
  operation: CoreOperationReference;
  binding: CoreBinding;
}
export interface CoreBindingRepository {
  binding(): Promise<CoreBinding | undefined>;
  saveBinding(binding: CoreBinding): Promise<void>;
  receipt(operationId: string): Promise<CoreBindingReceipt | undefined>;
  saveReceipt(receipt: CoreBindingReceipt): Promise<void>;
}
export interface CoreBindingRequest {
  actor: CorePrincipal;
  scope: CoreScopeReference;
  purpose: "initialize" | "original_receipt";
}
export interface CoreBindingLease {
  actor: CorePrincipal;
  scope: CoreScopeReference;
  canInitialize: boolean;
  canReadOriginal: boolean;
  revalidate(): Promise<void>;
}
export interface CoreBindingExecution {
  /** 原身份先锁、Core授权及范围再核，事务句柄仅在本回调中有效。 */
  run<T>(request: CoreBindingRequest, work: (repository: CoreBindingRepository,
    lease: CoreBindingLease, transaction: CoreTransaction) => Promise<T>): Promise<T>;
}

/** 稳定范围键同时含Core/租户/容器边界，供私有仓储与事务句柄复核。 */
export function coreBindingScopeKey(scope: CoreScopeReference): string {
  return JSON.stringify([scope.coreId, scope.tenantId, scope.container?.type ?? null, scope.container?.id ?? null]);
}

function fingerprint(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort()
      .map(key => [key, normalize((item as Record<string, unknown>)[key])]));
    return item;
  };
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export class CoreBindingService {
  constructor(private readonly execution: CoreBindingExecution,
    private readonly registrations: ReadonlyMap<string, CoreServerRegistration>,
    private readonly deployment: CoreDeploymentAvailability) {}

  bind(actor: CorePrincipal, input: unknown): Promise<CoreBinding> {
    const parsed = BindCoreScopeSchema.parse(input);
    const scope: CoreScopeReference = { coreId: parsed.coreId, tenantId: actor.tenantId,
      ...(parsed.container ? { container: parsed.container } : {}) };
    const registration = this.registrations.get(scope.coreId);
    if (!registration) throw new CoreAccessError("core_unavailable", "Core服务端贡献尚未注册");
    const domain = registration.manifest.scope;
    if (domain.kind === "tenant" && scope.container || domain.kind === "container" && scope.container?.type !== domain.containerType)
      throw new CoreAccessError("denied", "初始化范围与Core声明不一致");
    const request: CoreBindingRequest = { actor, scope, purpose: "initialize" };
    return this.execution.run(request, async (store, lease, transaction) => {
      this.authorized(request, lease);
      const hash = fingerprint({ actor, scope, request: parsed });
      const original = await store.receipt(parsed.operationId);
      if (original) {
        this.original(original, actor, scope);
        if (original.fingerprint !== hash) throw new CoreAccessError("operation_conflict", "原初始化操作键已用于不同输入");
        return original.binding;
      }
      await this.deployment.requireAvailable(scope.coreId, scope.tenantId);
      const existing = await store.binding();
      if ((existing?.revision ?? 0) !== parsed.expectedRevision)
        throw new CoreAccessError("revision_conflict", "Core绑定已变化，请读取原绑定后操作");
      let binding: CoreBinding;
      const operation = CoreOperationReferenceSchema.parse({ ...scope, operationId: parsed.operationId,
        action: "initialize", implementationVersion: registration.manifest.version });
      if (existing) {
        if (parsed.configuration !== undefined)
          throw new CoreAccessError("operation_conflict", "Core已绑定，配置修改须使用本Core的配置接口");
        if (!isCoreVersionSupported(existing.dataVersion, registration.manifest.data.readable))
          throw new CoreAccessError("core_unavailable", "原绑定数据版本不在当前Core可读范围");
        binding = existing;
      } else {
        binding = CoreBindingSchema.parse({ ...scope, bindingId: randomUUID(), revision: 1,
          dataVersion: registration.manifest.data.version });
        if (registration.server.initialization)
          await registration.server.initialization.initialize({ principal: actor, binding, operation, transaction }, parsed.configuration);
        else if (parsed.configuration !== undefined)
          throw new CoreAccessError("operation_conflict", "该Core未提供初始化配置接点");
        await store.saveBinding(binding);
      }
      await store.saveReceipt({ actor, fingerprint: hash, operation, binding });
      return binding;
    });
  }

  readOperation(actor: CorePrincipal, input: unknown): Promise<
    { status: "recorded"; operation: CoreOperationReference; binding: CoreBinding } | { status: "unavailable" }
  > {
    const parsed = CoreBindingOperationQuerySchema.parse(input);
    const scope: CoreScopeReference = { coreId: parsed.coreId, tenantId: actor.tenantId,
      ...(parsed.container ? { container: parsed.container } : {}) };
    const request: CoreBindingRequest = { actor, scope, purpose: "original_receipt" };
    return this.execution.run(request, async (store, lease) => {
      this.authorized(request, lease);
      const original = await store.receipt(parsed.operationId);
      if (!original) return { status: "unavailable" };
      this.original(original, actor, scope);
      return { status: "recorded", operation: original.operation, binding: original.binding };
    });
  }

  private authorized(request: CoreBindingRequest, lease: CoreBindingLease): void {
    if (request.actor.audience !== "operator" || lease.actor.audience !== request.actor.audience
      || lease.actor.tenantId !== request.actor.tenantId || lease.actor.subjectId !== request.actor.subjectId
      || coreBindingScopeKey(lease.scope) !== coreBindingScopeKey(request.scope)
      || request.purpose === "initialize" && !lease.canInitialize
      || request.purpose === "original_receipt" && !lease.canReadOriginal)
      throw new CoreAccessError("denied", "当前身份、Core范围或初始化操作权限不足");
  }

  private original(receipt: CoreBindingReceipt, actor: CorePrincipal, scope: CoreScopeReference): void {
    if (receipt.actor.tenantId !== actor.tenantId || receipt.actor.subjectId !== actor.subjectId || receipt.actor.audience !== actor.audience
      || coreBindingScopeKey(receipt.operation) !== coreBindingScopeKey(scope) || coreBindingScopeKey(receipt.binding) !== coreBindingScopeKey(scope))
      throw new CoreAccessError("operation_conflict", "原初始化操作不属于当前主体和Core范围");
  }
}

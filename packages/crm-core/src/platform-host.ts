/** 独立 CRM 适配只消费公共身份、Core 授权、事务与审计；不注册到平台壳或修改公共角色。
 * 首次绑定资格由公共绑定服务裁定，日常设置和本人原收据继续核当前 CRM 管理权限。 */
import { isCoreVersionSupported, type CoreBinding, type CoreScopeReference, type CoreScopeRequest,
  type CoreTransaction } from "@rental-os/core-contracts";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import { PlatformCoreAccess, type PlatformCoreBusinessAudit, type PlatformCoreTransaction,
  type PlatformCoreUsers, type PlatformCoreTermPolicy } from "@rental-os/platform-core-host";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";
import { CRM_CORE_ID, CRM_DATA_READABLE, CrmError, type CrmConfiguration } from "./contracts";
import { createMysqlCrmExecution, createMysqlCrmRepository, readCrmRemoval } from "./mysql";
import type { CrmStoredReceipt } from "./ports";
import { createCrmServer } from "./server";
import { CrmSettingsService } from "./service";

function sameBinding(left: CoreBinding | undefined, right: CoreBinding | undefined): boolean {
  return left === undefined ? right === undefined : right !== undefined && left.coreId === right.coreId
    && left.tenantId === right.tenantId && !left.container && !right.container && left.bindingId === right.bindingId
    && left.revision === right.revision && left.dataVersion === right.dataVersion;
}

export function composeCrmPlatformHost<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx> & Pick<Tx, "$queryRaw">;
  users: PlatformCoreUsers<Tx>;
  audit: PlatformCoreBusinessAudit<Tx>;
  term: PlatformCoreTermPolicy<Tx>;
  deployment: CoreDeploymentAvailability;
  /** 由公共绑定运行时解析自己的活跃句柄；禁止类型断言代替运行时范围核验。 */
  resolveTransaction(transaction: CoreTransaction, scope: CoreScopeReference): Tx;
  /** 已持原主体/成员锁时复用当前事务观察部署，避免另申请根连接。 */
  deploymentForTransaction?: (transaction: Tx) => CoreDeploymentAvailability;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const access = new PlatformCoreAccess<Tx>(input.term, input.deployment, input.deploymentForTransaction);
  const audit = (transaction: Tx, receipt: CrmStoredReceipt) => input.audit.recordCoreBusinessReceipt(transaction, {
    tenantId: receipt.settings.tenantId, userId: receipt.actorId, coreId: CRM_CORE_ID,
    targetType: "crm-settings", targetId: receipt.settings.tenantId, operationId: receipt.operationId,
    revision: receipt.settings.revision, fingerprint: receipt.fingerprint, state: "configured"
  });
  const execution = createMysqlCrmExecution<Tx>(input.database, {
    async authorize(transaction, request) {
      if (request.permission !== "manage" || request.purpose !== "business" && request.purpose !== "original_receipt"
        || request.purpose === "original_receipt" && request.mutation)
        throw new CrmError("denied", "CRM 请求不属于已登记的设置或原收据操作");
      const lease = await principals.lock(transaction, request.principal, request.principal.tenantId);
      const scope = { coreId: CRM_CORE_ID, tenantId: lease.principal.tenantId };
      let originalBinding: CoreBinding | undefined;
      const authorize = async (revalidation: boolean) => {
        const user = await lease.revalidate();
        if (user.isSaasAdmin || !hasEffectivePermission(user.permissions, "crm:settings:manage"))
          throw new CrmError("denied", "当前账号缺少 CRM 设置管理权限");
        if (request.purpose === "business") {
          await access.requireMember(transaction, user, CRM_CORE_ID);
          await access.requireBusinessAdmission(transaction, CRM_CORE_ID);
        }
        // 原收据只核本人原结果，不重新开放普通业务；现有角色权限与原绑定仍须有效。
        const binding = await access.binding(transaction, scope);
        if (!binding || !isCoreVersionSupported(binding.dataVersion, CRM_DATA_READABLE)
          || revalidation && !sameBinding(originalBinding, binding))
          throw new CrmError("denied", "CRM 原绑定已变化或数据版本不可读");
        originalBinding = binding;
        const current = await lease.revalidate();
        if (current.isSaasAdmin || !hasEffectivePermission(current.permissions, "crm:settings:manage"))
          throw new CrmError("denied", "当前 CRM 设置管理权限已变化");
        return current;
      };
      const user = await authorize(false);
      return { tenantId: user.tenantId, userId: user.id, revalidate: async () => { await authorize(true); } };
    },
    audit
  });

  const lockScope = async (transaction: Tx, request: CoreScopeRequest) => {
    if (request.principal.audience !== "operator" || request.scope.coreId !== CRM_CORE_ID || request.scope.container
      || request.scope.tenantId !== request.principal.tenantId)
      throw new CrmError("denied", "CRM 范围不符合当前租户主体");
    const lease = await principals.lock(transaction, request.principal, request.scope.tenantId);
    const authorize = async () => {
      const user = await lease.revalidate();
      if (user.isSaasAdmin) throw new CrmError("denied", "SaaS 管理身份不读取租户 CRM 业务配置");
      await access.requireMember(transaction, user, CRM_CORE_ID);
      await access.requireBusinessAdmission(transaction, CRM_CORE_ID);
      const binding = await access.binding(transaction, request.scope);
      if (binding && !isCoreVersionSupported(binding.dataVersion, CRM_DATA_READABLE))
        throw new CrmError("denied", "CRM 原绑定数据版本不可读");
      const current = await lease.revalidate();
      if (current.isSaasAdmin) throw new CrmError("denied", "当前 CRM 主体已变化");
      return binding;
    };
    const binding = await authorize();
    return { binding, revalidate: async () => {
      if (!sameBinding(binding, await authorize())) throw new CrmError("denied", "CRM 范围读取期间绑定已变化");
    } };
  };
  const resolveAuthorizedBinding = (request: CoreScopeRequest) => input.database.$transaction(async transaction => {
    const scope = await lockScope(transaction, request);
    await scope.revalidate();
    return scope.binding;
  }, { isolationLevel: "ReadCommitted" });
  const readConfiguration = (binding: CoreBinding) => input.database.$transaction(async transaction => {
    const scope = await lockScope(transaction, { principal: principals.current(), scope: { coreId: CRM_CORE_ID, tenantId: binding.tenantId } });
    if (!sameBinding(binding, scope.binding)) throw new CrmError("denied", "CRM 就绪读取不属于当前绑定");
    const repository = createMysqlCrmRepository(transaction, binding.tenantId, receipt => audit(transaction, receipt));
    const settings = await repository.settings();
    const pipeline = settings ? await repository.pipeline(settings.pipelineVersion) : undefined;
    const configuration: CrmConfiguration | undefined = settings && pipeline ? { settings, pipeline } : undefined;
    await scope.revalidate();
    return configuration;
  }, { isolationLevel: "ReadCommitted" });
  return { service: new CrmSettingsService(execution), principals, server: createCrmServer({
    resolveAuthorizedBinding, readConfiguration,
    initializationRepository(handle, scope) {
      const transaction = input.resolveTransaction(handle, scope);
      return createMysqlCrmRepository(transaction, scope.tenantId, receipt => audit(transaction, receipt));
    },
    assessRemoval: tenantId => readCrmRemoval(input.database, tenantId)
  }) };
}

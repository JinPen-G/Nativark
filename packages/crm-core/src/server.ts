/** CRM 生命周期只定义租户范围、首次配置和真实业务就绪；身份与原事务由受控宿主提供。
 * 初始化不创建公共角色或授予权限，也不以注册成功代替配置和物理数据观察。 */
import { CoreBindingSchema, CoreOperationReferenceSchema, defineCoreInitializer, isCoreVersionSupported,
  type CoreBinding, type CoreScopeReference, type CoreScopeRequest, type CoreServerContribution, type CoreTransaction } from "@rental-os/core-contracts";
import { CRM_CORE_ID, CRM_CORE_VERSION, CRM_DATA_VERSION, CRM_DATA_READABLE,
  CrmConfigurationSchema, CrmError, CrmSettingsInputSchema, type CrmConfiguration } from "./contracts";
import type { CrmRepository } from "./ports";
import { initializeCrmConfiguration } from "./service";

export interface CrmServerAuthority {
  resolveAuthorizedBinding(request: CoreScopeRequest): Promise<CoreBinding | undefined>;
  /** 宿主核定当前主体及绑定，再读取配置；返回值只供就绪判断，不作为公开配置接口。 */
  readConfiguration(binding: CoreBinding): Promise<CrmConfiguration | undefined>;
  /** 必须解析宿主发放的活跃句柄，返回该绑定事务内的 CRM 窄仓储，不能另开事务。 */
  initializationRepository(transaction: CoreTransaction, scope: CoreScopeReference): CrmRepository;
  assessRemoval?: CoreServerContribution["assessRemoval"];
}

function readableBinding(value: CoreBinding): CoreBinding | undefined {
  const parsed = CoreBindingSchema.safeParse(value);
  return parsed.success && parsed.data.coreId === CRM_CORE_ID && !parsed.data.container
    && isCoreVersionSupported(parsed.data.dataVersion, CRM_DATA_READABLE) ? parsed.data : undefined;
}

export function createCrmServer(authority: CrmServerAuthority, clock: () => Date = () => new Date()): CoreServerContribution {
  return {
    coreId: CRM_CORE_ID,
    implementationVersion: CRM_CORE_VERSION,
    async resolveScope(request) {
      if (request.principal.audience !== "operator" || request.scope.coreId !== CRM_CORE_ID
        || request.scope.tenantId !== request.principal.tenantId || request.scope.container) return { status: "denied" };
      const binding = await authority.resolveAuthorizedBinding(request);
      if (!binding) return { status: "unbound" };
      const current = readableBinding(binding);
      if (!current || current.tenantId !== request.principal.tenantId) return { status: "denied" };
      return { status: "resolved", binding: current };
    },
    async readReadiness(binding) {
      const current = readableBinding(binding);
      if (!current) return { status: "unavailable", code: "crm_data_version", message: "CRM 绑定或数据版本不符合当前实现" };
      try {
        const configuration = CrmConfigurationSchema.safeParse(await authority.readConfiguration(current));
        if (!configuration.success || configuration.data.settings.tenantId !== current.tenantId
          || configuration.data.pipeline.version !== configuration.data.settings.pipelineVersion)
          return { status: "unavailable", code: "crm_configuration_missing", message: "CRM 首次设置或销售流程版本缺失" };
        return { status: "ready" };
      } catch {
        // 读取故障、撤权和损坏配置都不能被空配置或默认样例覆盖成可用。
        return { status: "unavailable", code: "crm_configuration_unavailable", message: "无法核实当前 CRM 配置" };
      }
    },
    initialization: defineCoreInitializer(CrmSettingsInputSchema, async (context, input) => {
      const binding = readableBinding(context.binding), operation = CoreOperationReferenceSchema.safeParse(context.operation);
      if (context.principal.audience !== "operator" || !binding || binding.tenantId !== context.principal.tenantId
        || binding.dataVersion !== CRM_DATA_VERSION || binding.revision !== 1 || !operation.success
        || operation.data.coreId !== CRM_CORE_ID || operation.data.tenantId !== binding.tenantId || operation.data.container
        || operation.data.action !== "initialize" || operation.data.implementationVersion !== CRM_CORE_VERSION)
        throw new CrmError("denied", "CRM 初始化主体、候选绑定与原操作范围不一致");
      const store = authority.initializationRepository(context.transaction, { coreId: CRM_CORE_ID, tenantId: binding.tenantId });
      await initializeCrmConfiguration(store, context.principal, input, clock);
    }),
    ...(authority.assessRemoval ? { assessRemoval: authority.assessRemoval.bind(authority) } : {})
  };
}

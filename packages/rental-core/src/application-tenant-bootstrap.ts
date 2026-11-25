/** 原租户、管理员与首个Rental空间的一次初始化。
 * 原仓储与品类配置在同一事务提交；公共身份、密码和部署状态来自底座。
 * 此管理入口不授予Core/成员使用权，不覆盖已有租户，也不重放失应答的创建操作。 */
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { normalizeOperatorShortName, type SystemUserRow } from "@rental-os/platform-contracts";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import { createMysqlCoreDeploymentAdmission } from "@rental-os/core-host/mysql-deployment-admission";
import { RENTAL_CATEGORY_DEFINITIONS, isRentalCategoryCode } from "./contracts";
import { RENTAL_CORE_ID } from "./core-identity";
import type { RentalCoreService } from "./mysql-core-runtime";
import type { RentalWorkspaceManagementDatabase, RentalWorkspaceManagementRepository } from "./mysql-workspace-management";
import { createRentalTenantBootstrapPreview, type createRentalTenantBootstrapSeed } from "./tenant-bootstrap-defaults";
import type { TenantBootstrapPreview, TenantBootstrapRequest, TenantBootstrapResult } from "./tenant-bootstrap-contracts";

export type { TenantBootstrapPreview, TenantBootstrapRequest, TenantBootstrapResult } from "./tenant-bootstrap-contracts";

/** 与原PlatformService相同的输入裁定；内存演示仍拒绝动态品类和明确选版。 */
export function normalizeRentalTenantBootstrapInput(input: TenantBootstrapRequest,
  options: { persistent: boolean; coreAvailable: boolean }): TenantBootstrapRequest {
  let operatorShortName: string | null | undefined;
  try { operatorShortName = normalizeOperatorShortName(input.operatorShortName); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new BadRequestException(error.message);
  }
  input = { ...input, operatorShortName };
  const tenantCode = input.tenantCode.trim().toLowerCase();
  const tenantName = input.tenantName.trim();
  const adminAccount = input.adminAccount.trim();
  const adminDisplayName = input.adminDisplayName.trim();
  if (!tenantCode || !tenantName || !adminAccount || !adminDisplayName || !input.categoryCode) {
    throw new BadRequestException("租户编码、名称、经营品类和管理员信息不能为空");
  }
  if (!isRentalCategoryCode(input.categoryCode)) throw new BadRequestException("经营品类不存在");
  if (!options.persistent && !RENTAL_CATEGORY_DEFINITIONS.some(category => category.code === input.categoryCode)) {
    throw new ConflictException("动态品类需要持久化品类目录与发布版本");
  }
  if (input.categoryVersionId !== undefined && (typeof input.categoryVersionId !== "string"
    || !input.categoryVersionId.trim() || input.categoryVersionId.length > 191)) {
    throw new BadRequestException("请选择合法的品类发布版本");
  }
  if (input.categoryVersionId && !options.persistent) throw new ConflictException("明确选版需要持久化品类目录与发布版本");
  if (options.persistent && !options.coreAvailable) throw new ConflictException("Rental初始化服务未装配，不能创建租赁租户");
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(tenantCode)) {
    throw new BadRequestException("租户编码必须以小写字母开头，只能包含小写字母、数字、下划线和短横线");
  }
  return input;
}

export interface RentalTenantBootstrapDependencies {
  database: Pick<RentalWorkspaceManagementDatabase, "$transaction">;
  repository: Pick<RentalWorkspaceManagementRepository, "bootstrapTenant">;
  users: { findUserById(id: string, transaction?: Prisma.TransactionClient): Promise<SystemUserRow | undefined> };
  core: Pick<RentalCoreService<Prisma.TransactionClient>, "initializeTenant" | "getWorkspaceCategoryInTransaction"
    | "onApplicationBootstrap" | "persist">;
  seed(): ReturnType<typeof createRentalTenantBootstrapSeed>;
  /** 同一原初始化事务观察已安装的Rental及停新状态，不另申请根数据库连接。 */
  deploymentForTransaction(transaction: Prisma.TransactionClient): CoreDeploymentAvailability;
}

export class RentalTenantBootstrapApplication {
  private readonly principals: PlatformPrincipalAuthority<Prisma.TransactionClient>;
  readonly httpAccess: RegisteredCoreHttpAccess;

  constructor(private readonly input: RentalTenantBootstrapDependencies) {
    this.principals = new PlatformPrincipalAuthority(input.users);
    this.httpAccess = Object.freeze<RegisteredCoreHttpAccess>({
      registered: (method, path, audience) => audience === "operator" && (
        (method === "GET" || method === "HEAD") && path === "/platform/tenant-bootstrap/preview"
        || method === "POST" && path === "/platform/tenant-bootstrap"),
      authorize: async (method, path) => {
        if (!this.httpAccess.registered(method, path, "operator")) throw new ForbiddenException("该初始化接口未登记");
        await this.input.database.$transaction(async transaction => {
          const revalidate = await this.lockAuthority(transaction);
          await revalidate();
        }, { isolationLevel: "ReadCommitted" });
      }
    });
  }

  getTenantBootstrapPreview(): TenantBootstrapPreview {
    return createRentalTenantBootstrapPreview(this.input.seed());
  }

  async bootstrapTenant(input: TenantBootstrapRequest, currentUser?: SystemUserRow): Promise<TenantBootstrapResult> {
    if (!currentUser?.isSaasAdmin) throw new ForbiddenException("仅 SaaS 平台管理员可以管理租户");
    input = normalizeRentalTenantBootstrapInput(input, { persistent: true, coreAvailable: true });
    const result = await this.input.repository.bootstrapTenant(input, this.getTenantBootstrapPreview(), this.input.seed(),
      async (transaction, tenantId) => {
        await this.input.core.initializeTenant(tenantId, input.categoryCode, transaction, input.currency,
          { categoryVersionId: input.categoryVersionId, actorId: currentUser.id });
        const category = await this.input.core.getWorkspaceCategoryInTransaction(tenantId, `ws_${tenantId}`, input.categoryCode, transaction);
        return { categoryName: category.name };
      }, transaction => this.lockAuthority(transaction, currentUser));
    // 原事务已提交，才发布品类/空间缓存；失败后的重读沿原租户，不重复创建或改临时密码。
    await this.input.core.onApplicationBootstrap();
    await this.input.core.persist(result.tenant.tenantId);
    return result;
  }

  private async lockAuthority(transaction: Prisma.TransactionClient, expected?: SystemUserRow): Promise<() => Promise<void>> {
    const source = getRequestIdentity(), principal = this.principals.current();
    const lease = await this.principals.lock(transaction, principal, principal.tenantId);
    const verify = async (user: SystemUserRow) => {
      if (getRequestIdentity() !== source || !user.isSaasAdmin || !user.isActive || user.mustChangePassword
        || user.id !== principal.subjectId || user.tenantId !== principal.tenantId
        || expected && (expected.id !== user.id || expected.tenantId !== user.tenantId)
        || !user.permissions.some(permission => ["*", "system:tenant:bootstrap", "system:tenant:manage"].includes(permission))) {
        throw new ForbiddenException("当前SaaS租户初始化权限或会话已变化");
      }
      await this.input.deploymentForTransaction(transaction).requireAvailable(RENTAL_CORE_ID, user.tenantId);
      await createMysqlCoreDeploymentAdmission(transaction).requireAccepting(RENTAL_CORE_ID);
    };
    await verify(lease.user);
    return async () => verify(await lease.revalidate());
  }
}

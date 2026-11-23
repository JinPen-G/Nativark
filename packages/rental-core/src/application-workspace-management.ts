/** 租户初始化与经营空间管理的唯一门面。保留原主体/固定全权保护、品类版本与必选能力的同事务初始化。
 * 宿主提供同一数据库和业务服务；不创建会话、不伪造空间，不用构造成功代替 Core 当前准入。 */
import { BadRequestException, ConflictException, ForbiddenException, Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import type { SystemUserRow, SystemRoleRow, SaveSystemUserRequest } from "@rental-os/platform-contracts";
import { requireRequestTenantId } from "@rental-os/platform-server/request-identity";
import { RENTAL_CATEGORY_DEFINITIONS } from "./contracts";
import type { CreateBusinessWorkspaceRequest, UpdateBusinessWorkspaceRequest, SaveWorkspaceMemberRequest,
  SaveSystemUserAccessRequest, RentalCategoryCode } from "./contracts";
import type { RentalCategoryOpeningOptionsQuery } from "./category-governance";
import type { RentalCoreService } from "./mysql-core-runtime";
import type { WorkspaceCapabilityService } from "./workspace-capabilities";
import { RentalWorkspaceManagementRepository } from "./mysql-workspace-management";
import type { RentalApplication } from "./application";
import { RentalTenantBootstrapApplication, type RentalTenantBootstrapDependencies } from "./application-tenant-bootstrap";
import { createRentalTenantBootstrapSeed } from "./tenant-bootstrap-defaults";
import type { TenantBootstrapRequest, TenantBootstrapResult } from "./tenant-bootstrap-contracts";

export interface RentalWorkspaceManagementDependencies {
  configService: Pick<ConfigService, "get">;
  repository: Pick<RentalWorkspaceManagementRepository, "getTenant" | "listBusinessWorkspacesForTenant" | "createBusinessWorkspaceForTenant" | "updateBusinessWorkspaceForTenant" | "listBusinessWorkspaces" | "createBusinessWorkspace" | "updateBusinessWorkspace" | "listWorkspaceMembers" | "listWorkspaceFulfillmentLocations" | "saveWorkspaceMember" | "saveUserWithWorkspaceAccess" | "hasFixedAllPermissionRole" | "isTenantAdminUser">;
  rentalCoreService?: Pick<RentalCoreService<Prisma.TransactionClient>, "registerWorkspace" | "getWorkspaceCategoryInTransaction" | "onApplicationBootstrap" | "getCategoryOpeningOptions">;
  workspaceCapabilityService?: Pick<WorkspaceCapabilityService<Prisma.TransactionClient>, "initializeRequiredCapabilities" | "overview">;
  logger: Pick<Logger, "warn">;
  /** 只有实际独立宿主供给同事务部署观察后，才开放原SaaS租户初始化。 */
  tenantBootstrap?: RentalTenantBootstrapApplication;
  /** 仅原内存兼容宿主传入原行读取器；不成为新宿主的权限或持久化事实。 */
  legacyAccounts?: {
    roles(): readonly Pick<SystemRoleRow, "id" | "tenantId" | "isActive" | "fixedAllPermissions">[];
    users(): readonly { id: string; tenantId: string; isPlatformAdmin?: boolean; roleIds: string[] }[];
  };
}

export function createRentalWorkspaceManagementApplication(application: RentalApplication,
  options?: Pick<RentalTenantBootstrapDependencies, "deploymentForTransaction">) {
  const repository = new RentalWorkspaceManagementRepository(application.database);
  return new RentalWorkspaceManagementApplication({ configService: application.configuration,
    repository,
    rentalCoreService: application.primary.core, workspaceCapabilityService: application.foundation.capabilities,
    tenantBootstrap: options ? new RentalTenantBootstrapApplication({ database: application.database,
      repository, users: application.authSource, core: application.primary.core,
      seed: createRentalTenantBootstrapSeed, deploymentForTransaction: options.deploymentForTransaction }) : undefined,
    logger: new Logger(RentalWorkspaceManagementApplication.name) });
}

export class RentalWorkspaceManagementApplication {
  constructor(private readonly input: RentalWorkspaceManagementDependencies) {}
  private requireTenantBootstrap() {
    if (!this.input.tenantBootstrap) throw new ConflictException("Rental租户初始化及同事务部署观察未装配");
    return this.input.tenantBootstrap;
  }

  get tenantBootstrapHttpAccess() { return this.requireTenantBootstrap().httpAccess; }
  getTenantBootstrapPreview() { return this.requireTenantBootstrap().getTenantBootstrapPreview(); }
  bootstrapTenant(input: TenantBootstrapRequest, currentUser?: SystemUserRow): Promise<TenantBootstrapResult> {
    return this.requireTenantBootstrap().bootstrapTenant(input, currentUser);
  }

  private legacyAccounts() {
    if (!this.input.legacyAccounts) throw new BadRequestException("经营空间管理需要 MySQL 数据源，当前为内存演示模式");
    return this.input.legacyAccounts;
  }


  async getRentalCategoryOpeningOptions(query: RentalCategoryOpeningOptionsQuery, currentUser?: SystemUserRow) {
    this.assertSaasAdmin(currentUser);
    if (!this.input.rentalCoreService) throw new ConflictException("Rental品类目录未装配");
    return this.input.rentalCoreService.getCategoryOpeningOptions(query, this.useMysqlDataSource() ? "published" : "builtin_demo");
  }

  async listTenantBusinessWorkspaces(tenantId: string, currentUser?: SystemUserRow) {
    this.assertSaasAdmin(currentUser);
    this.requireWorkspaceDataSource();
    await this.input.repository.getTenant(tenantId);
    return this.input.repository.listBusinessWorkspacesForTenant(tenantId);
  }


  async createTenantBusinessWorkspace(
    tenantId: string,
    input: CreateBusinessWorkspaceRequest,
    currentUser?: SystemUserRow
  ) {
    this.assertSaasAdmin(currentUser);
    this.requireWorkspaceDataSource();
    if (!this.input.rentalCoreService) throw new ConflictException("Rental初始化服务未装配，不能创建租赁空间");
    await this.input.repository.getTenant(tenantId);
    const result = await this.input.repository.createBusinessWorkspaceForTenant(
      tenantId,
      input,
      async (tx, workspaceId) => {
        await this.input.rentalCoreService!.registerWorkspace(workspaceId, tenantId, input.categoryCode, tx);
        // 与 createBusinessWorkspace 同一口径：必选能力与空间档案原子创建。
        await this.initializeWorkspaceCapabilities(
          tenantId,
          workspaceId,
          input.categoryCode,
          tx,
          undefined,
          input.runMode ?? "development"
        );
        const tenantAdmins = await tx.user.findMany({
          where: { tenantId, isPlatformAdmin: true, isActive: true },
          select: { id: true }
        });
        if (tenantAdmins.length) {
          await tx.workspaceMember.createMany({
            data: tenantAdmins.map((admin) => ({ tenantId, workspaceId, userId: admin.id, isActive: true })),
            skipDuplicates: true
          });
        }
      },
      currentUser?.id
    );
    await this.input.rentalCoreService?.onApplicationBootstrap();
    return result;
  }


  async updateTenantBusinessWorkspace(
    tenantId: string,
    workspaceId: string,
    input: UpdateBusinessWorkspaceRequest,
    currentUser?: SystemUserRow
  ) {
    this.assertSaasAdmin(currentUser);
    this.requireWorkspaceDataSource();
    await this.input.repository.getTenant(tenantId);
    await this.assertProductionModeAllowed(tenantId, workspaceId, input);
    return this.input.repository.updateBusinessWorkspaceForTenant(tenantId, workspaceId, input);
  }


  /**
   * SPACE-01：经营空间主档与成员关系一律以 MySQL 为事实源。
   *
   * 刻意不提供内存模式实现：内存假数据源在本项目造成过 P0-01（跨租户泄露被
   * 演示固件掩盖），四份文档都写明不得把内存数据源当成持久化的证明。
   * 空间隔离是安全边界，宁可在无库时明确拒绝，也不给一个"看起来能用"的假实现。
   */
  private requireWorkspaceDataSource() {
    if (!this.useMysqlDataSource()) {
      throw new BadRequestException("经营空间管理需要 MySQL 数据源，当前为内存演示模式");
    }
  }


  listBusinessWorkspaces(currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.input.repository.listBusinessWorkspaces(currentUser);
  }


  async createBusinessWorkspace(input: CreateBusinessWorkspaceRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    if (!this.input.rentalCoreService) throw new ConflictException("Rental初始化服务未装配，不能创建租赁空间");
    // 需求 4.1：空间档案与其品类配置同事务创建，任一步失败整体回滚。
    const result = await this.input.repository.createBusinessWorkspace(input, currentUser, async (tx, workspaceId, tenantId) => {
      await this.input.rentalCoreService!.registerWorkspace(workspaceId, tenantId, input.categoryCode, tx);
      // Review P1-3：品类必选能力必须与空间档案原子创建。放在同一 tx 里，
      // 任一步失败则空间与能力实例一起回滚，不会留下「空间已建、能力没开」的半成品
      // ——那种空间在正式经营模式下连报价都做不了。
      await this.initializeWorkspaceCapabilities(
        tenantId,
        workspaceId,
        input.categoryCode,
        tx,
        currentUser,
        input.runMode ?? "development"
      );
    });
    // 仓储事务已经提交，才允许将新空间发布到本进程缓存。
    await this.input.rentalCoreService?.onApplicationBootstrap();
    return result;
  }


  /**
   * 在给定事务内初始化某空间的品类必选能力。
   *
   * 品类声明集从**品类定义**读取，与能力服务的 `overview` 同源；不接受调用方传入，
   * 否则调用方可以声明一份自选的必选清单。
   */
  async initializeWorkspaceCapabilities(
    tenantId: string,
    workspaceId: string,
    categoryCode: RentalCategoryCode,
    tx: Prisma.TransactionClient,
    currentUser?: SystemUserRow,
    runMode: "production" | "demo" | "development" = "development"
  ) {
    if (!this.input.workspaceCapabilityService) {
      if (runMode === "production") {
        throw new ConflictException("能力服务不可用，不能创建正式经营空间");
      }
      return;
    }
    const category = this.input.rentalCoreService
      ? await this.input.rentalCoreService.getWorkspaceCategoryInTransaction(tenantId, workspaceId, categoryCode, tx)
      : RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === categoryCode);
    const declared = category?.defaultCapabilities ?? [];
    const required = category?.requiredCapabilities ?? [];
    const result = await this.input.workspaceCapabilityService.initializeRequiredCapabilities(
      tenantId,
      workspaceId,
      categoryCode,
      declared,
      tx,
      { operator: currentUser?.displayName, requiredCodes: required }
    );
    if (result.skipped.length) {
      // 跳过的必选能力不是错误（未实现、或必填配置无默认值），但必须留痕：
      // 空间会保持非生产就绪，运营需要知道还差什么。
      this.input.logger.warn(
        `空间 ${workspaceId} 初始化必选能力时跳过：` +
          result.skipped.map((row) => `${row.code}（${row.why}）`).join("；")
      );
    }
    if (runMode === "production") {
      const enabled = new Set(result.enabled);
      const missing = required.filter((code) => !enabled.has(code));
      if (missing.length) {
        throw new ConflictException(
          `正式经营空间初始化失败：缺少可自动启用的必选能力 ${missing.join("、")}。` +
            "请改为演示/开发模式创建，或先补齐能力实现与默认配置。"
        );
      }
    }
  }


  async updateBusinessWorkspace(id: string, input: UpdateBusinessWorkspaceRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    await this.assertProductionModeAllowed(tenantId, id, input);
    return this.input.repository.updateBusinessWorkspace(id, input, currentUser);
  }


  private async assertProductionModeAllowed(
    tenantId: string,
    workspaceId: string,
    input: UpdateBusinessWorkspaceRequest
  ) {
    if (input.runMode !== "production") return;
    if (!this.input.workspaceCapabilityService) {
      throw new ConflictException("能力服务不可用，不能将经营空间切换为正式经营模式");
    }
    const overview = await this.input.workspaceCapabilityService.overview(tenantId, workspaceId);
    if (!overview.productionReady) {
      throw new ConflictException(
        `经营空间尚未达到正式经营条件：缺少必选能力 ${overview.missingRequired.join("、")}`
      );
    }
  }


  listWorkspaceMembers(workspaceId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.input.repository.listWorkspaceMembers(workspaceId, currentUser);
  }


  listWorkspaceFulfillmentLocations(workspaceId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.input.repository.listWorkspaceFulfillmentLocations(workspaceId, currentUser);
  }


  saveWorkspaceMember(workspaceId: string, input: SaveWorkspaceMemberRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.input.repository.saveWorkspaceMember(workspaceId, input, currentUser);
  }


  /**
   * ACCESS-01C：账号资料、租户角色和经营空间授权必须共用一个事务。
   *
   * 运营账号页面原先先保存账号，再并行保存各空间成员关系；其中一个空间
   * 失败时会留下半套授权。该入口只允许在真实空间数据源上执行，避免内存
   * 演示模式伪造空间权限事实。
   */
  async saveUserWithWorkspaceAccess(
    input: SaveSystemUserAccessRequest,
    currentUser?: SystemUserRow
  ) {
    const targetTenantId = this.resolveTargetTenantId(input.tenantId, currentUser);
    await this.assertTenantAdminPrivilegeWrite(input, targetTenantId, currentUser);
    this.requireWorkspaceDataSource();
    return this.input.repository.saveUserWithWorkspaceAccess(
      { ...input, tenantId: targetTenantId, isSaasAdmin: false },
      targetTenantId,
      currentUser?.id
    );
  }


  private useMysqlDataSource() {
    return (
      this.input.configService.get<string>("PLATFORM_DATA_SOURCE") ?? "mysql"
    ).toLowerCase() === "mysql";
  }


  private assertSaasAdmin(user?: SystemUserRow) {
    if (!user?.isSaasAdmin) {
      throw new ForbiddenException("仅 SaaS 平台管理员可以管理租户");
    }
  }


  private resolveTargetTenantId(requestedTenantId: string | undefined, user?: SystemUserRow) {
    if (!user) throw new ForbiddenException("缺少登录用户上下文");
    if (user.isSaasAdmin) {
      if (!requestedTenantId) throw new BadRequestException("SaaS 平台操作必须明确目标租户");
      return requestedTenantId;
    }
    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      throw new ForbiddenException("不能访问或修改其他租户的数据");
    }
    return user.tenantId;
  }


  /** 管理员标志和固定全权角色属于租户边界，不能仅依赖路由权限或客户端提交值。 */
  async assertTenantAdminPrivilegeWrite(
    input: Partial<Pick<SaveSystemUserRequest, "id" | "isPlatformAdmin" | "roleIds">>,
    tenantId: string,
    currentUser?: SystemUserRow
  ) {
    const actorIsTenantAdmin = Boolean(
      currentUser?.id && currentUser.tenantId === tenantId && currentUser.isPlatformAdmin && !currentUser.isSaasAdmin
    );
    let targetIsTenantAdmin = false;
    const workspaceRoleIds = "workspaceAccesses" in input && Array.isArray(input.workspaceAccesses)
      ? input.workspaceAccesses.map((access) => access.roleId).filter((roleId): roleId is string => Boolean(roleId))
      : [];
    const requestedRoleIds = [...new Set([...(input.roleIds ?? []), ...workspaceRoleIds])];
    let assignsFixedAllPermissions = false;
    if (requestedRoleIds.length) {
      if (this.useMysqlDataSource()) {
        assignsFixedAllPermissions = await this.input.repository.hasFixedAllPermissionRole(requestedRoleIds, tenantId);
      } else {
        assignsFixedAllPermissions = requestedRoleIds.some((roleId) =>
          this.legacyAccounts().roles().some((role) => role.id === roleId && role.tenantId === tenantId && role.isActive && role.fixedAllPermissions)
        );
      }
    }
    if (input.id) {
      if (this.useMysqlDataSource()) {
        targetIsTenantAdmin = await this.input.repository.isTenantAdminUser(input.id, tenantId);
      } else {
        const target = this.legacyAccounts().users().find((user) => user.id === input.id && user.tenantId === tenantId);
        targetIsTenantAdmin = Boolean(target && (
          target.isPlatformAdmin || target.roleIds.some((roleId) =>
            this.legacyAccounts().roles().some((role) => role.id === roleId && role.tenantId === tenantId && role.isActive && role.fixedAllPermissions)
          )
        ));
      }
    }
    if (!actorIsTenantAdmin && (input.isPlatformAdmin === true || targetIsTenantAdmin || assignsFixedAllPermissions)) {
      throw new ForbiddenException("只有当前租户管理员可以新增、修改或撤销租户管理员权限");
    }
  }
}

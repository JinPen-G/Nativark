/** 原组合的公共身份与 Rental 业务仓储接点。
 * 公共身份沿原身份仓储读取，筛选预设复用公共服务的当前主体与同事务审计，空间、邀请与开业通过原业务接点办理。 */
import { assertOriginalMcpWorkspaceIntegrationManagement } from "@rental-os/rental-mcp-host/workspace-management";
import { RentalWorkspaceManagementRepository } from "@rental-os/rental-core/mysql-workspace-management";
/** Rental及既有组合平台的仓储；公共登录/账号/会话继承唯一身份仓储。
 * 业务空间、客户与Rental初始化保留本域事务和校验，不成为无Core认证的依赖。 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { PlatformIdentityRepository } from "./platform-identity.repository";
import { RentalWorkspacePrincipalRepository, type WorkspaceSessionIdentity, type RentalMemberSessionIdentity,
  type RentalWorkspaceAccessTransaction } from "@rental-os/rental-core/mysql-workspace-principal";
import { readPlatformSecurityBaseline } from "@rental-os/platform-server/security";
import { PlatformFilterPresetService } from "@rental-os/platform-server/tools";
import { randomUUID } from "node:crypto";
import { assertCategoryAdoptionAllowed } from "../rental-core/category-governance-policy";
import { rentalCategoryStorageCode } from "../rental-core/category-identity";
import {
  ConfigStatus,
  OrganizationType as PrismaOrganizationType,
  Prisma,
  RoleScope as PrismaRoleScope,
  SystemDataScope as PrismaSystemDataScope,
  TenantStatus as PrismaTenantStatus,
  WorkspaceStatus as PrismaWorkspaceStatus,
} from "@prisma/client";
import type {
  BusinessWorkspace,
  BusinessWorkspaceStatus,
  CreateBusinessWorkspaceRequest,
  SaveWorkspaceMemberRequest,
  UpdateBusinessWorkspaceRequest,
  WorkspaceMember,
  OrganizationSummary,
  PlatformAuditLogQuery,
  PlatformAuditLogRow,
  PlatformAuditResult,
  PlatformDictionaryGroup,
  PlatformFilterPreset,
  PlatformFilterPresetQuery,
  PlatformNumberRule,
  SaveOrganizationRequest,
  SavePlatformFilterPresetRequest,
  SaveSystemUserAccessRequest,
  SaveSystemUserRequest,
  SaveWorkspaceAccessRequest,
  SystemRulesConfig,
  SystemUserRow,
  TenantBootstrapPreview,
  TenantBootstrapRequest,
  TenantBootstrapResult,
  TenantSummary
} from "@rental-os/shared";
import { RentalCategoryCode, RoleScope } from "@rental-os/shared";
import { generateTemporaryPassword, hashPassword } from "../../common/password";
import {
  buildOrganizationWhere,
  isOrganizationScopedUser,
  resolveTenantIdForQuery
} from "../../common/data-permission";
import { enabledOrganizationSubtreeIds } from "../../common/organization-location-scope";
import { PrismaService } from "../database/prisma.service";
import { getRequestWorkspaceId, requireRequestTenantId } from "../../common/request-identity";

/** Internal authenticated identity, supplied by Auth rather than an HTTP DTO. */
export type { WorkspaceSessionIdentity, RentalMemberSessionIdentity, RentalWorkspaceAccessTransaction } from "@rental-os/rental-core/mysql-workspace-principal";

@Injectable()
export class PlatformRepository extends PlatformIdentityRepository {
  private workspaceManagement?: RentalWorkspaceManagementRepository;
  private getWorkspaceManagementRepository() {
    return this.workspaceManagement ??= new RentalWorkspaceManagementRepository(this.prisma);
  }

  private readonly workspacePrincipals: RentalWorkspacePrincipalRepository<RentalWorkspaceAccessTransaction>;

  constructor(
    protected readonly prisma: PrismaService,
    @Optional() private readonly publicFilterPresets?: PlatformFilterPresetService
  ) {
    super(prisma);
    this.workspacePrincipals = new RentalWorkspacePrincipalRepository<RentalWorkspaceAccessTransaction>(prisma, {
      findUserById: (userId, transaction) => this.findUserById(userId, transaction),
      projectWorkspace: row => this.toWorkspace(row),
      projectRoleScope: scope => this.toSharedRoleScope(scope),
      projectDataScope: scope => this.toSharedDataScope(scope)
    });
  }

  private requirePublicFilterPresets(): PlatformFilterPresetService {
    if (!this.publicFilterPresets) {
      throw new ServiceUnavailableException("公共筛选预设服务未装配");
    }
    return this.publicFilterPresets;
  }

  /** 登录前没有会话；只读平台主体的原生效安全配置，与独立公共认证共用读取算法。 */
  getSecurityBaseline() { return readPlatformSecurityBaseline(this.prisma); }

  /** Principal locks precede commercial/category/workspace business locks.
   * Existing revocation writers update these same rows. Lock assignments and
   * permission rows too, so removal cannot slip between mapping and commit.
   * No business table is written or authorized by this platform adapter. */
  async lockWorkspaceSessionUser(tx: Prisma.TransactionClient, expected: WorkspaceSessionIdentity): Promise<SystemUserRow> {
    return this.workspacePrincipals.lockWorkspaceSessionUser(tx, expected);
  }

  /** Read under the principal locks held by lockWorkspaceSessionUser. */
  async readWorkspaceSessionUser(tx: Prisma.TransactionClient, expected: WorkspaceSessionIdentity): Promise<SystemUserRow> {
    return this.workspacePrincipals.readWorkspaceSessionUser(tx, expected);
  }

  lockMemberSessionUser(tx: RentalWorkspaceAccessTransaction, expected: RentalMemberSessionIdentity,
    parentLock: "exclusive" | "shared" = "exclusive") {
    return this.workspacePrincipals.lockMemberSessionUser(tx, expected, parentLock);
  }

  readMemberSessionUser(tx: RentalWorkspaceAccessTransaction, expected: RentalMemberSessionIdentity) {
    return this.workspacePrincipals.readMemberSessionUser(tx, expected);
  }

  /** Original current account/role mapping in the caller's existing transaction.
   * Explicit workspace must belong to the bound tenant; no session/default-space
   * fallback. The original authority owns Serializable isolation and grant fences. */
  async resolveTrustedWorkspacePrincipal(binding: { userId: string; tenantId: string; workspaceId: string }, transaction: Prisma.TransactionClient) {
    return this.workspacePrincipals.resolveTrustedWorkspacePrincipal(binding, transaction);
  }

  /** MCP workspace governance reuses ORIGINAL tenant-wide integration rights.
   * An all-permissions workspace role is not a tenant management permission.
   * Identity/session verification remains in original Auth; caller owns the same
   * Serializable transaction and commit fences, not a model-supplied binding. */
  async assertTrustedWorkspaceIntegrationManagement(binding: { userId: string; tenantId: string; workspaceId: string }, transaction: Prisma.TransactionClient) {
    return assertOriginalMcpWorkspaceIntegrationManagement({
      assertTenantPermissionInTransaction: this.assertTenantPermissionInTransaction.bind(this),
      resolveTrustedWorkspacePrincipal: this.resolveTrustedWorkspacePrincipal.bind(this),
    }, binding, transaction);
  }

  /** 本机开发演示账号的统一重置；调用方已完成非生产环境与密码策略校验。 */
  async setLocalDemoAccountPassword(password: string) {
    const users = await this.prisma.user.findMany({
      where: { account: "admin", tenant: { code: { in: ["demo", "demo2", "platform"] } } },
      select: { id: true, tenant: { select: { code: true } } }
    });
    if (users.length !== 3) {
      throw new BadRequestException("本地演示账号尚未初始化，请先完成数据库初始化");
    }
    const expected = new Set(["demo", "demo2", "platform"]);
    if (users.some((user) => !expected.delete(user.tenant.code)) || expected.size > 0) {
      throw new BadRequestException("本地演示账号不完整，请先完成数据库初始化");
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const user of users) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash: hashPassword(password),
            mustChangePassword: false,
            passwordChangedAt: now,
            tokenVersion: { increment: 1 }
          }
        });
      }
      await tx.authSession.updateMany({
        where: { userId: { in: users.map((user) => user.id) }, revokedAt: null },
        data: { revokedAt: now }
      });
    });
  }

  /* ---------- SPACE-01：经营空间主档与成员关系 ---------- */

  /**
   * 空间范围只取自服务端会话，绝不接受客户端提交的 tenantId。
   * 需求 2.3：租户业务请求中的当前经营空间必须来自服务端验证过的会话上下文。
   */
  private workspaceTenantId(currentUser?: SystemUserRow): string {
    return this.getWorkspaceManagementRepository().workspaceTenantId(currentUser);
  }

  /**
   * SPACE-03：按**经营空间**取品类与业务能力。
   *
   * 守卫原先用租户级 `tenant_rental_profiles` 的品类做 capability 与车辆域校验。
   * 同租户有多个空间且品类不同时那是错的：一个 camping 空间会被按 camera 的
   * 能力集放行。品类的事实源是 `business_workspaces.categoryCode`（需求 3），
   * 能力取该品类定义的默认能力集。
   */
  async getWorkspaceCategoryContext(
    tenantId: string,
    workspaceId: string
  ): Promise<{ categoryCode?: TenantSummary["categoryCode"]; categoryName?: string; capabilities?: TenantSummary["capabilities"] }> {
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { id: workspaceId, tenantId },
      include: { category: { select: { name: true, defaultCapabilities: true } } }
    });
    if (!workspace) return {};
    return {
      categoryCode: this.toDomainCategoryCode(workspace.categoryCode),
      // categoryName 供前端直接展示；缺了它，切换空间后标题仍是旧品类名。
      categoryName: workspace.category.name,
      capabilities: workspace.category.defaultCapabilities as unknown as TenantSummary["capabilities"]
    };
  }

  async listBusinessWorkspaces(currentUser?: SystemUserRow): Promise<BusinessWorkspace[]> {
    return this.getWorkspaceManagementRepository().listBusinessWorkspaces(currentUser);
  }

  async listBusinessWorkspacesForTenant(tenantId: string): Promise<BusinessWorkspace[]> {
    return this.getWorkspaceManagementRepository().listBusinessWorkspacesForTenant(tenantId);
  }

  async createBusinessWorkspace(
    input: CreateBusinessWorkspaceRequest,
    currentUser?: SystemUserRow,
    /**
     * 在创建空间的**同一事务内**、提交之前执行。
     * 需求 4.1：新增空间必须原子创建空间档案与品类配置，抛错则一起回滚。
     */
    onBeforeCommit?: (tx: Prisma.TransactionClient, workspaceId: string, tenantId: string) => Promise<void>
  ): Promise<BusinessWorkspace> {
    return this.getWorkspaceManagementRepository().createBusinessWorkspace(input, currentUser, onBeforeCommit);
  }

  async createBusinessWorkspaceForTenant(
    tenantId: string,
    input: CreateBusinessWorkspaceRequest,
    onBeforeCommit?: (tx: Prisma.TransactionClient, workspaceId: string, tenantId: string) => Promise<void>,
    actorId?: string
  ): Promise<BusinessWorkspace> {
    return this.getWorkspaceManagementRepository().createBusinessWorkspaceForTenant(tenantId, input, onBeforeCommit, actorId);
  }

  async updateBusinessWorkspace(
    id: string,
    input: UpdateBusinessWorkspaceRequest,
    currentUser?: SystemUserRow
  ): Promise<BusinessWorkspace> {
    return this.getWorkspaceManagementRepository().updateBusinessWorkspace(id, input, currentUser);
  }

  async updateBusinessWorkspaceForTenant(
    tenantId: string,
    id: string,
    input: UpdateBusinessWorkspaceRequest
  ): Promise<BusinessWorkspace> {
    return this.getWorkspaceManagementRepository().updateBusinessWorkspaceForTenant(tenantId, id, input);
  }

  async listWorkspaceMembers(workspaceId: string, currentUser?: SystemUserRow): Promise<WorkspaceMember[]> {
    return this.getWorkspaceManagementRepository().listWorkspaceMembers(workspaceId, currentUser);
  }

  async listWorkspaceFulfillmentLocations(workspaceId: string, currentUser?: SystemUserRow) {
    return this.getWorkspaceManagementRepository().listWorkspaceFulfillmentLocations(workspaceId, currentUser);
  }

  async saveWorkspaceMember(
    workspaceId: string,
    input: SaveWorkspaceMemberRequest,
    currentUser?: SystemUserRow
  ): Promise<WorkspaceMember> {
    return this.getWorkspaceManagementRepository().saveWorkspaceMember(workspaceId, input, currentUser);
  }

  private toWorkspace(row: {
    id: string;
    tenantId: string;
    code: string;
    name: string;
    categoryCode: RentalCategoryCode;
    status: PrismaWorkspaceStatus;
    isDefault: boolean;
    runMode?: string;
    createdAt: Date;
    updatedAt: Date;
  }): BusinessWorkspace {
    return this.getWorkspaceManagementRepository().toWorkspace(row);
  }

  private toWorkspaceMember(row: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    roleId: string | null;
    dataScope: PrismaSystemDataScope | null;
    locationScope?: Prisma.JsonValue | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): WorkspaceMember {
    return this.getWorkspaceManagementRepository().toWorkspaceMember(row);
  }

  private toPrismaWorkspaceStatus(status: BusinessWorkspaceStatus): PrismaWorkspaceStatus {
    return this.getWorkspaceManagementRepository().toPrismaWorkspaceStatus(status);
  }

  /* ---------- SPACE-02：会话空间上下文 ---------- */

  /**
   * 该账号可进入的经营空间：必须是**启用的成员关系**且空间本身启用。
   * 冻结/停用的空间不出现在可进入列表里，因此前端也拿不到可切换项。
   */
  async listUserWorkspaces(userId: string): Promise<BusinessWorkspace[]> {
    return this.workspacePrincipals.listUserWorkspaces(userId);
  }

  /**
   * 校验并解析会话的当前经营空间。
   *
   * 传入 workspaceId 时逐项校验（成员关系启用、空间启用、租户匹配）；
   * 不传时按「默认空间优先，否则第一个可进入空间」解析。
   * 返回 undefined 表示该账号没有任何可进入空间（如平台管理租户）——
   * 这不是错误，但经营接口会对此 fail-closed。
   *
   * 跨租户由成员关系保证：`workspace_members` 的复合外键已使
   * 「账号在该空间有成员关系」蕴含两者同租户，因此按 userId 查成员即可，
   * 不需要也不应该再信任调用方传来的 tenantId。
   */
  async resolveSessionWorkspaceId(userId: string, requested?: string): Promise<string | undefined> {
    return this.workspacePrincipals.resolveSessionWorkspaceId(userId, requested);
  }

  /**
   * 按当前经营空间解析账号权限。
   *
   * 需求 3：同一账号可在不同空间拥有不同角色和数据范围。因此成员关系上的
   * roleId 一旦存在，就**取代**租户级角色参与权限计算；dataScope 同理。
   * 成员关系没配时沿用租户级默认值（升级兼容层的行为）。
   */
  async findWorkspaceScopedUser(userId: string, workspaceId?: string, tenantUser?: SystemUserRow, transaction?: Prisma.TransactionClient): Promise<SystemUserRow | undefined> {
    return this.workspacePrincipals.findWorkspaceScopedUser(userId, workspaceId, tenantUser, transaction);
  }

  async setSessionWorkspace(sessionId: string, workspaceId: string | null, expectedWorkspaceId?: string | null): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        ...(expectedWorkspaceId === undefined
          ? {}
          : { currentWorkspaceId: expectedWorkspaceId })
      },
      data: { currentWorkspaceId: workspaceId }
    });
    return result.count === 1;
  }

  /**
   * 旧 `/rental-os/*` 车辆域的表仍只有 tenantId，尚未完成空间级迁移。
   * 在迁移完成前只允许默认车辆空间使用这组兼容接口，禁止非默认空间把
   * 同一套租户级车辆数据伪装成自己的空间数据。
   */
  async isLegacyVehicleDomainWorkspaceAllowed(tenantId: string, workspaceId: string): Promise<boolean> {
    const [current, defaultWorkspace] = await Promise.all([
      this.prisma.businessWorkspace.findFirst({
        where: { id: workspaceId, tenantId, categoryCode: RentalCategoryCode.Vehicle },
        select: { id: true }
      }),
      this.prisma.businessWorkspace.findFirst({
        where: { tenantId, isDefault: true, categoryCode: RentalCategoryCode.Vehicle },
        select: { id: true }
      })
    ]);
    return Boolean(current && defaultWorkspace && current.id === defaultWorkspace.id);
  }

  async listOrganizations(
    tenantId?: string,
    currentUser?: SystemUserRow
  ): Promise<OrganizationSummary[]> {
    if (isOrganizationScopedUser(currentUser)) {
      const scopedTenantId = resolveTenantIdForQuery(tenantId, currentUser);
      if (!scopedTenantId || !currentUser.organizationId) return [];
      const organizations = await this.prisma.organizationUnit.findMany({
        where: { tenantId: scopedTenantId },
        orderBy: [{ tenantId: "asc" }, { code: "asc" }]
      });
      const allowedOrganizationIds = new Set(enabledOrganizationSubtreeIds(
        organizations.map((organization) => ({
          id: organization.id,
          parentId: organization.parentId,
          status: organization.status
        })),
        currentUser.organizationId
      ));
      return organizations
        .filter((organization) => allowedOrganizationIds.has(organization.id))
        .map((organization) => this.toOrganizationSummary(organization));
    }

    const organizations = await this.prisma.organizationUnit.findMany({
      where: buildOrganizationWhere(
        tenantId,
        currentUser
      ) as Prisma.OrganizationUnitWhereInput,
      orderBy: [{ tenantId: "asc" }, { code: "asc" }]
    });

    return organizations.map((organization) => this.toOrganizationSummary(organization));
  }

  async getOrganizationTenantId(id: string) {
    return (await this.prisma.organizationUnit.findUnique({ where: { id }, select: { tenantId: true } }))?.tenantId;
  }

  async getRoleTenantId(id: string) {
    return (await this.prisma.role.findUnique({ where: { id }, select: { tenantId: true } }))?.tenantId;
  }

  async getUserTenantId(id: string) {
    return (await this.prisma.user.findUnique({ where: { id }, select: { tenantId: true } }))?.tenantId;
  }

  async saveOrganization(input: SaveOrganizationRequest): Promise<OrganizationSummary> {
    const code = input.code.trim();
    const name = input.name.trim();
    const parentId = input.parentId?.trim() || undefined;
    const status = input.status ?? "enabled";

    if (!code || !name) {
      throw new BadRequestException("组织编码和组织名称不能为空");
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId }
    });
    if (!tenant) {
      throw new BadRequestException("租户不存在");
    }
    const duplicated = await this.prisma.organizationUnit.findFirst({
      where: {
        id: { not: input.id },
        tenantId: input.tenantId,
        code
      }
    });
    if (duplicated) {
      throw new BadRequestException("该租户下组织编码已存在");
    }
    if (parentId) {
      if (parentId === input.id) {
        throw new BadRequestException("上级组织不能选择自身");
      }
      const parent = await this.prisma.organizationUnit.findFirst({
        where: { id: parentId, tenantId: input.tenantId }
      });
      if (!parent) {
        throw new BadRequestException("上级组织不属于当前租户");
      }
    }

    const existing = input.id
      ? await this.prisma.organizationUnit.findFirst({
          where: { id: input.id, tenantId: input.tenantId }
        })
      : undefined;
    if (input.id && !existing) {
      throw new NotFoundException("组织不存在");
    }
    const id = input.id ?? `org_${randomUUID()}`;
    const row = await this.prisma.organizationUnit.upsert({
      where: { id },
      update: {
        parentId,
        type: this.toPrismaOrganizationType(input.type),
        code,
        name,
        status
      },
      create: {
        id,
        tenantId: input.tenantId,
        parentId,
        type: this.toPrismaOrganizationType(input.type),
        code,
        name,
        status
      }
    });

    await this.recordAuditLog({
      tenantId: row.tenantId,
      action: existing ? "organization.update" : "organization.create",
      operator: input.operator ?? "平台管理员",
      targetType: "organization",
      targetId: row.id,
      detail: `${existing ? "更新" : "创建"}组织 ${row.name}`
    });

    return this.toOrganizationSummary(row);
  }

  async setOrganizationStatus(
    id: string,
    status: OrganizationSummary["status"],
    operator = "平台管理员"
  ): Promise<OrganizationSummary> {
    const existing = await this.prisma.organizationUnit.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("组织不存在");
    }

    const row = await this.prisma.organizationUnit.update({
      where: { id },
      data: { status }
    });
    await this.recordAuditLog({
      tenantId: row.tenantId,
      action: "organization.status",
      operator,
      targetType: "organization",
      targetId: row.id,
      detail: `${status === "enabled" ? "启用" : "停用"}组织 ${row.name}`
    });

    return this.toOrganizationSummary(row);
  }

  /** 含停用账号；服务层需防止普通账号通过编辑停用管理员来撤销其固定权限。 */
  async isTenantAdminUser(id: string, tenantId: string): Promise<boolean> {
    return this.getWorkspaceManagementRepository().isTenantAdminUser(id, tenantId);
  }

  async hasFixedAllPermissionRole(roleIds: readonly string[], tenantId: string): Promise<boolean> {
    return this.getWorkspaceManagementRepository().hasFixedAllPermissionRole(roleIds, tenantId);
  }

  async saveUserWithWorkspaceAccess(
    input: SaveSystemUserAccessRequest,
    tenantId: string,
    actorUserId?: string
  ): Promise<SystemUserRow> {
    return this.getWorkspaceManagementRepository().saveUserWithWorkspaceAccess(input, tenantId, actorUserId);
  }

  /** 邮箱邀请只准备待接受授权；发信和接受都复验原租户角色/空间关系，不提前建账号。 */
  async validateOperatorInvitationAccess(tx: Prisma.TransactionClient, tenantId: string, actorUserId: string,
    input: Pick<SaveSystemUserAccessRequest, "roleIds" | "organizationId" | "workspaceAccesses">) {
    const actor = await this.assertTenantPermissionInTransaction(tx, tenantId, actorUserId, "system:user:manage");
    if (!Array.isArray(input.roleIds) || !input.roleIds.length || input.roleIds.length > 8 || new Set(input.roleIds).size !== input.roleIds.length)
      throw new BadRequestException("请选择有效的租户基础角色");
    const accesses = input.workspaceAccesses;
    if (!Array.isArray(accesses) || !accesses.length || accesses.length > 100 || accesses.some(row => !row.isActive || !row.roleId)
      || new Set(accesses.map(row => row.workspaceId)).size !== accesses.length) throw new BadRequestException("邀请需选择至少一个经营空间及对应角色，不能重复选择空间");
    const roleIds = [...new Set([...input.roleIds, ...accesses.map(row => row.roleId!)])];
    const [roles, workspaces, organization] = await Promise.all([
      tx.role.findMany({ where: { tenantId, id: { in: roleIds }, isActive: true }, select: { id: true, name: true, code: true, fixedAllPermissions: true } }),
      tx.businessWorkspace.findMany({ where: { tenantId, id: { in: accesses.map(row => row.workspaceId) }, status: PrismaWorkspaceStatus.ACTIVE }, select: { id: true, name: true } }),
      input.organizationId ? tx.organizationUnit.findFirst({ where: { tenantId, id: input.organizationId, status: "enabled" }, select: { id: true } }) : Promise.resolve(undefined)
    ]);
    if (roles.length !== roleIds.length || workspaces.length !== accesses.length || input.organizationId && !organization)
      throw new BadRequestException("角色、组织或经营空间已变更，请重新核对邀请授权");
    if (roles.some(role => input.roleIds.includes(role.id) && (role.code === "TENANT_ADMIN" || role.fixedAllPermissions)))
      throw new BadRequestException("运营邀请不能直接授予租户管理员身份，请在加入后通过原账号管理流程设置");
    if (!actor.isPlatformAdmin && roles.some(role => role.fixedAllPermissions)) throw new ForbiddenException("只有租户管理员可以邀请使用固定全权空间角色的用户");
    for (const access of accesses) {
      if (access.dataScope !== undefined && !["all", "organization", "store", "own"].includes(access.dataScope)) throw new BadRequestException("空间数据范围无效");
      if (access.locationScope !== undefined) await this.validateLocationScope(tx, tenantId, access.workspaceId, access.locationScope);
    }
    return { actorName: actor.displayName, roleNames: input.roleIds.map(id => roles.find(row => row.id === id)!.name),
      workspaceNames: accesses.map(access => workspaces.find(row => row.id === access.workspaceId)!.name) };
  }

  /** 一次性邀请的账号、租户角色与空间成员关系在调用方同一事务内生效。 */
  async acceptOperatorInvitationInTransaction(tx: Prisma.TransactionClient, tenantId: string, actorUserId: string,
    input: SaveSystemUserAccessRequest, passwordHash: string) {
    await this.validateOperatorInvitationAccess(tx, tenantId, actorUserId, input);
    const saved = await this.saveUserInTransaction(tx, { ...input, id: undefined, isSaasAdmin: false, isPlatformAdmin: false }, tenantId, actorUserId);
    await tx.user.update({ where: { id: saved.userId, tenantId }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } });
    await this.saveWorkspaceAccessesInTransaction(tx, tenantId, saved.userId, input.workspaceAccesses);
    return saved.userId;
  }

  private async saveUserInTransaction(
    tx: Prisma.TransactionClient,
    input: SaveSystemUserRequest,
    tenantId: string,
    actorUserId?: string
  ): Promise<{ userId: string; temporaryPassword?: string }> {
    return this.getWorkspaceManagementRepository().saveUserInTransaction(tx, input, tenantId, actorUserId);
  }

  /** 空间授权也不能把固定全权角色当成普通空间角色批量授给员工。 */
  private async assertFixedAllWorkspaceAccessesAllowed(
    tx: Prisma.TransactionClient,
    tenantId: string,
    accesses: SaveWorkspaceAccessRequest[],
    actorUserId?: string
  ) {
    return this.getWorkspaceManagementRepository().assertFixedAllWorkspaceAccessesAllowed(tx, tenantId, accesses, actorUserId);
  }

  private async saveWorkspaceAccessesInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    accesses: SaveWorkspaceAccessRequest[]
  ) {
    return this.getWorkspaceManagementRepository().saveWorkspaceAccessesInTransaction(tx, tenantId, userId, accesses);
  }

  private async assertTenantPermissionInTransaction(
    tx: Prisma.TransactionClient, tenantId: string, actorUserId: string | undefined, permission: string
  ) {
    return this.getWorkspaceManagementRepository().assertTenantPermissionInTransaction(tx, tenantId, actorUserId, permission);
  }

  /** 公共租户管理入口复用基础租户角色，不读取空间覆盖权限。 */
  async assertTenantManagementPermission(tenantId: string, actorUserId: string, permission: string,
    tx: Prisma.TransactionClient = this.prisma) {
    return this.assertTenantPermissionInTransaction(tx, tenantId, actorUserId, permission);
  }

  async getSystemRules(tenantId = requireRequestTenantId()) {
    const row = await this.prisma.systemParameterSet.findFirst({
      where: {
        tenantId,
        module: "system-rules",
        status: "EFFECTIVE"
      },
      orderBy: { versionNo: "desc" }
    });
    return row?.content as unknown as SystemRulesConfig | undefined;
  }

  async saveSystemRules(
    config: SystemRulesConfig,
    operator = "system",
    tenantId = requireRequestTenantId()
  ) {
    const row = await this.prisma.systemParameterSet.findFirst({
      where: { tenantId, module: "system-rules", status: "EFFECTIVE" },
      orderBy: { versionNo: "desc" }
    });
    const versionNo = row?.versionNo ?? 1;

    return this.prisma.systemParameterSet.upsert({
      where: {
        tenantId_module_versionNo: {
          tenantId,
          module: "system-rules",
          versionNo
        }
      },
      update: { content: config as object, operator },
      create: {
        tenantId,
        module: "system-rules",
        versionNo,
        status: "EFFECTIVE",
        content: config as object,
        operator
      }
    });
  }

  async listAuditLogs(
    query: PlatformAuditLogQuery = {}
  ): Promise<PlatformAuditResult> {
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    // 审计是经营事实的一部分：普通经营会话只能回看当前空间的动作。
    // 平台管理会话没有 workspaceId，保留租户级平台审计的查询能力；绝不从
    // query 参数读取空间，避免客户端借此跨空间枚举审计记录。
    const workspaceId = getRequestWorkspaceId();
    const where: Prisma.OperationLogWhereInput = {
      tenantId: query.tenantId || requireRequestTenantId(),
      workspaceId,
      action: query.action ? { contains: query.action } : undefined
    };
    const [rows, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: limit
      }),
      this.prisma.operationLog.count({ where })
    ]);
    const mapped = rows
      .map((row) => this.toAuditLogRow(row))
      .filter((row) => !query.operator || row.operator.includes(query.operator))
      .filter((row) => !query.targetType || row.targetType === query.targetType);

    return {
      rows: mapped,
      total
    };
  }

  async recordAuditLog(input: Omit<PlatformAuditLogRow, "id" | "createdAt">) {
    await this.prisma.operationLog.create({
      data: {
        tenantId: input.tenantId,
        action: input.action,
        detail: {
          operator: input.operator,
          targetType: input.targetType,
          targetId: input.targetId,
          detail: input.detail
        }
      }
    });
  }

  async listFilterPresets(
    query: PlatformFilterPresetQuery = {}
  ): Promise<PlatformFilterPreset[]> {
    return this.requirePublicFilterPresets().listFilterPresets(query);
  }

  async saveFilterPreset(
    input: SavePlatformFilterPresetRequest
  ): Promise<PlatformFilterPreset> {
    return this.requirePublicFilterPresets().saveFilterPreset(input);
  }

  /** 旧第三参数保留内部调用形状；当前主体、租户与审计由公共服务统一读取。 */
  async setDefaultFilterPreset(
    id: string,
    operator?: string,
    _tenantId?: string
  ): Promise<PlatformFilterPreset> {
    return this.requirePublicFilterPresets().setDefaultFilterPreset(id, operator);
  }

  async deleteFilterPreset(
    id: string,
    operator?: string,
    _tenantId?: string
  ) {
    return this.requirePublicFilterPresets().deleteFilterPreset(id, operator);
  }

  async bootstrapTenant(
    input: TenantBootstrapRequest,
    preview: TenantBootstrapPreview,
    seed: {
      systemRules: SystemRulesConfig;
      dictionaries: PlatformDictionaryGroup[];
      numberRules: PlatformNumberRule[];
    },
    /**
     * 在初始化事务内、提交之前执行。用于把 Rental Core 品类配置并入同一事务，
     * 满足需求 4.1「初始化失败必须整体回滚」；抛错会连带回滚租户、组织、角色和管理员。
     */
    onBeforeCommit?: (tx: Prisma.TransactionClient, tenantId: string) => Promise<void | { categoryName: string }>
  ): Promise<TenantBootstrapResult> {
    return this.getWorkspaceManagementRepository().bootstrapTenant(input, preview, seed, onBeforeCommit);
  }

  private toAuditLogRow(row: {
    id: string;
    tenantId: string;
    workspaceId: string | null;
    action: string;
    detail: Prisma.JsonValue;
    createdAt: Date;
    user?: { displayName: string; account: string } | null;
  }): PlatformAuditLogRow {
    const detail =
      row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
        ? (row.detail as Record<string, unknown>)
        : {};
    const operator = String(
      detail.operator ?? row.user?.displayName ?? row.user?.account ?? "系统"
    );

    return {
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId ?? undefined,
      action: row.action,
      operator,
      targetType: String(detail.targetType ?? "system"),
      targetId: detail.targetId ? String(detail.targetId) : undefined,
      detail: String(detail.detail ?? JSON.stringify(row.detail)),
      createdAt: row.createdAt.toISOString()
    };
  }

  private async getPlatformConfig<T>(module: string, tenantId?: string) {
    const row = await this.prisma.systemParameterSet.findFirst({
      where: {
        tenantId,
        module,
        status: ConfigStatus.EFFECTIVE
      },
      orderBy: { versionNo: "desc" }
    });
    return row?.content as T | undefined;
  }

  private async savePlatformConfig(
    tenantId: string,
    module: string,
    content: unknown
  ) {
    return this.prisma.systemParameterSet.upsert({
      where: {
        tenantId_module_versionNo: {
          tenantId,
          module,
          versionNo: 1
        }
      },
      update: {
        content: content as Prisma.InputJsonValue,
        operator: "platform-governance",
        status: ConfigStatus.EFFECTIVE
      },
      create: {
        tenantId,
        module,
        versionNo: 1,
        status: ConfigStatus.EFFECTIVE,
        content: content as Prisma.InputJsonValue,
        operator: "platform-governance"
      }
    });
  }

  private async resolveConfigTenantId() {
    const requestTenantId = requireRequestTenantId();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: requestTenantId }
    });
    if (!tenant) {
      throw new NotFoundException("当前登录租户不存在");
    }
    return tenant.id;
  }

  private async validateLocationScope(
    tx: Prisma.TransactionClient,
    tenantId: string,
    workspaceId: string,
    scope: NonNullable<SaveWorkspaceAccessRequest["locationScope"]>
  ): Promise<Prisma.InputJsonValue> {
    return this.getWorkspaceManagementRepository().validateLocationScope(tx, tenantId, workspaceId, scope);
  }

  // 读取兼容旧枚举对象；持久化编码及领域契约统一使用稳定的小写标识。
  private toDomainCategoryCode(value: string | null | undefined): TenantSummary["categoryCode"] | undefined {
    return this.getWorkspaceManagementRepository().toDomainCategoryCode(value);
  }

  private toPrismaCategoryCode(value: string): RentalCategoryCode {
    return this.getWorkspaceManagementRepository().toPrismaCategoryCode(value);
  }

  private toOrganizationSummary(organization: {
    id: string;
    tenantId: string;
    parentId: string | null;
    type: PrismaOrganizationType;
    code: string;
    name: string;
    status: string;
  }): OrganizationSummary {
    return {
      id: organization.id,
      tenantId: organization.tenantId,
      parentId: organization.parentId ?? undefined,
      type: this.toSharedRoleScope(organization.type),
      code: organization.code,
      name: organization.name,
      status: organization.status === "disabled" ? "disabled" : "enabled"
    };
  }

  private toPrismaOrganizationType(scope: RoleScope): PrismaOrganizationType {
    if (scope === RoleScope.CarShop) {
      return PrismaOrganizationType.CAR_SHOP;
    }
    if (scope === RoleScope.Store) {
      return PrismaOrganizationType.STORE;
    }
    if (scope === RoleScope.Station) {
      return PrismaOrganizationType.STATION;
    }
    return PrismaOrganizationType.OPERATOR;
  }

}

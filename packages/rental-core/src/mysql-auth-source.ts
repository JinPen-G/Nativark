/** Rental 的持久认证适配，公共账号/原签名会话继承唯一公共仓储，空间权威复用原六入口。
 * 使用宿主同一数据库和调用方事务；不提供内存账号、合成空间或默认授权。 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { PlatformAuthenticationRepository } from "@rental-os/platform-server/authentication";
import type { PlatformAuthDataStore } from "@rental-os/platform-server/auth-store";
import { hashPassword } from "@rental-os/platform-server/password";
import type { RentalAuthenticationSource } from "./auth-source";
import type { TenantSummary } from "./auth-contracts";
import { RentalCategoryCode, type BusinessWorkspace } from "./contracts";
import { RentalWorkspacePrincipalRepository, type RentalWorkspacePrincipalStorage,
  type WorkspaceSessionIdentity } from "./mysql-workspace-principal";

interface DemoPasswordTransaction {
  user: Pick<PlatformAuthDataStore["user"], "update">;
  authSession: { updateMany(input: { where: { userId: { in: string[] }; revokedAt: null };
    data: { revokedAt: Date } }): PromiseLike<{ count: number }> };
}

/** 仅包含本适配新增的真实查询，公共认证存储与空间存储继续复用原合同。 */
export type RentalMysqlAuthenticationDatabase = PlatformAuthDataStore & RentalWorkspacePrincipalStorage & {
  businessWorkspace: Pick<Prisma.TransactionClient["businessWorkspace"], "findFirst">;
  user: PlatformAuthDataStore["user"] & {
    findMany(input: { where: { account: "admin"; tenant: { code: { in: string[] } } };
      select: { id: true; tenant: { select: { code: true } } } }): PromiseLike<Array<{ id: string; tenant: { code: string } }>>;
  };
  authSession: PlatformAuthDataStore["authSession"] & {
    updateMany(input: { where: { id: string; currentWorkspaceId?: string | null };
      data: { currentWorkspaceId: string | null } }): PromiseLike<{ count: number }>;
  };
  $transaction<T>(work: (transaction: DemoPasswordTransaction) => Promise<T>): Promise<T>;
};

export class RentalMysqlAuthenticationRepository extends PlatformAuthenticationRepository implements RentalAuthenticationSource {
  private readonly workspacePrincipals: RentalWorkspacePrincipalRepository<Prisma.TransactionClient>;

  constructor(private readonly database: RentalMysqlAuthenticationDatabase) {
    super(database);
    this.workspacePrincipals = new RentalWorkspacePrincipalRepository<Prisma.TransactionClient>(database, {
      findUserById: (userId, transaction) => this.findUserById(userId, transaction),
      projectWorkspace: row => this.toWorkspace(row),
      projectRoleScope: scope => this.toSharedRoleScope(scope),
      projectDataScope: scope => this.toSharedDataScope(scope)
    });
  }

  listUserWorkspaces(userId: string) { return this.workspacePrincipals.listUserWorkspaces(userId); }
  resolveSessionWorkspaceId(userId: string, requested?: string) {
    return this.workspacePrincipals.resolveSessionWorkspaceId(userId, requested);
  }
  findWorkspaceScopedUser(userId: string, workspaceId?: string, tenantUser?: SystemUserRow,
    transaction?: Prisma.TransactionClient) {
    return this.workspacePrincipals.findWorkspaceScopedUser(userId, workspaceId, tenantUser, transaction);
  }
  resolveTrustedWorkspacePrincipal(binding: { userId: string; tenantId: string; workspaceId: string },
    transaction: Prisma.TransactionClient) {
    return this.workspacePrincipals.resolveTrustedWorkspacePrincipal(binding, transaction);
  }
  lockWorkspaceSessionUser(transaction: Prisma.TransactionClient, expected: WorkspaceSessionIdentity) {
    return this.workspacePrincipals.lockWorkspaceSessionUser(transaction, expected);
  }
  readWorkspaceSessionUser(transaction: Prisma.TransactionClient, expected: WorkspaceSessionIdentity) {
    return this.workspacePrincipals.readWorkspaceSessionUser(transaction, expected);
  }

  /** 品类取当前空间，不能用同租户另一空间的档案补齐缺失信息。 */
  async getWorkspaceCategoryContext(tenantId: string, workspaceId: string): Promise<{
    categoryCode?: TenantSummary["categoryCode"]; categoryName?: string; capabilities?: TenantSummary["capabilities"];
  }> {
    const workspace = await this.database.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId },
      include: { category: { select: { name: true, defaultCapabilities: true } } } });
    if (!workspace) return {};
    return { categoryCode: this.toDomainCategoryCode(workspace.categoryCode), categoryName: workspace.category.name,
      capabilities: workspace.category.defaultCapabilities as TenantSummary["capabilities"] };
  }

  /** 原车辆兼容表仍按租户持有，仅原默认车辆空间可进入。 */
  async isLegacyVehicleDomainWorkspaceAllowed(tenantId: string, workspaceId: string): Promise<boolean> {
    const [current, defaultWorkspace] = await Promise.all([
      this.database.businessWorkspace.findFirst({
        where: { id: workspaceId, tenantId, categoryCode: RentalCategoryCode.Vehicle }, select: { id: true } }),
      this.database.businessWorkspace.findFirst({
        where: { tenantId, isDefault: true, categoryCode: RentalCategoryCode.Vehicle }, select: { id: true } })
    ]);
    return Boolean(current && defaultWorkspace && current.id === defaultWorkspace.id);
  }

  /** 原会话空间的条件更新，竞争切换失败不能覆盖新空间。 */
  async setSessionWorkspace(sessionId: string, workspaceId: string | null, expectedWorkspaceId?: string | null): Promise<boolean> {
    const result = await this.database.authSession.updateMany({ where: { id: sessionId,
      ...(expectedWorkspaceId === undefined ? {} : { currentWorkspaceId: expectedWorkspaceId }) },
      data: { currentWorkspaceId: workspaceId } });
    return result.count === 1;
  }

  /** 原 Auth 先核本机开发环境与密码政策；此处只重置已存在且完整的原三个账号。 */
  async setLocalDemoAccountPassword(password: string): Promise<void> {
    const users = await this.database.user.findMany({
      where: { account: "admin", tenant: { code: { in: ["demo", "demo2", "platform"] } } },
      select: { id: true, tenant: { select: { code: true } } }
    });
    if (users.length !== 3) throw new BadRequestException("本地演示账号尚未初始化，请先完成数据库初始化");
    const expected = new Set(["demo", "demo2", "platform"]);
    if (users.some(user => !expected.delete(user.tenant.code)) || expected.size > 0)
      throw new BadRequestException("本地演示账号不完整，请先完成数据库初始化");
    const now = new Date();
    await this.database.$transaction(async (transaction: DemoPasswordTransaction) => {
      for (const user of users) await transaction.user.update({ where: { id: user.id }, data: {
        passwordHash: hashPassword(password), mustChangePassword: false, passwordChangedAt: now, tokenVersion: { increment: 1 }
      } });
      await transaction.authSession.updateMany({ where: { userId: { in: users.map(user => user.id) }, revokedAt: null },
        data: { revokedAt: now } });
    });
  }

  /** 在调用方原事务重新核平台账号；空间通配角色及输入对象不能替代 SaaS 身份。 */
  async assertTrustedSaasManagement(binding: { userId: string; tenantId: string }, transaction: Prisma.TransactionClient) {
    if (!transaction?.user || !binding || typeof binding !== "object" || Array.isArray(binding)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(binding)))
      throw new ForbiddenException("可信平台管理需要原持久身份系统");
    const fields = Object.getOwnPropertyDescriptors(binding), userId = fields.userId, tenantId = fields.tenantId;
    const valid = (field: PropertyDescriptor | undefined): field is PropertyDescriptor & { value: string } =>
      Boolean(field?.enumerable && Object.hasOwn(field, "value") && typeof field.value === "string"
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(field.value));
    if (Reflect.ownKeys(fields).length !== 2 || !valid(userId) || !valid(tenantId))
      throw new ForbiddenException("缺少当前平台管理主体");
    const user = await this.findUserById(userId.value, transaction);
    if (!user || user.id !== userId.value || user.tenantId !== tenantId.value || user.isActive !== true
      || user.isSaasAdmin !== true || user.mustChangePassword !== false)
      throw new ForbiddenException("缺少当前平台管理身份");
    return Object.freeze({ userId: user.id, tenantId: user.tenantId });
  }

  private toDomainCategoryCode(value: string | null | undefined): TenantSummary["categoryCode"] | undefined {
    return value ? value.toLowerCase() as TenantSummary["categoryCode"] : undefined;
  }

  private toWorkspace(row: Prisma.BusinessWorkspaceGetPayload<object>): BusinessWorkspace {
    return { id: row.id, tenantId: row.tenantId, code: row.code, name: row.name,
      categoryCode: this.toDomainCategoryCode(row.categoryCode) as BusinessWorkspace["categoryCode"],
      status: row.status.toLowerCase() as BusinessWorkspace["status"], isDefault: row.isDefault,
      runMode: row.runMode as BusinessWorkspace["runMode"] ?? "production",
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
}

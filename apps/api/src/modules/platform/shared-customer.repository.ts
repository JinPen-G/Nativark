import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CustomerWorkspaceLink,
  SaveSharedCustomerRequest,
  SharedCustomerProfile
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";

export type SharedCustomerTx = Prisma.TransactionClient;

/**
 * SPACE-04：共享客户主档的库侧唯一入口。
 *
 * 隔离口径与其他仓储不同，必须分清两层，否则会把「共享」做成「泄露」：
 * - **主档**按 `tenantId` 共享：同租户任一空间都能查到同一个客户，这是需求要的复用。
 * - **业务关系**按 `workspaceId` 隔离：客户在哪个空间有业务、等级多少，各空间独立。
 *
 * 因此主档查询只带 tenantId 条件（跨空间可见是**设计**，不是漏洞），
 * 而关系查询一律带 workspaceId。两者不能互相套用。
 */
@Injectable()
export class SharedCustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private mask(phone: string) {
    const trimmed = phone.trim();
    if (trimmed.length <= 4) return trimmed;
    return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
  }

  /** 按租户列出共享客户主档；关系详情只附带当前空间，绝不暴露其他空间。 */
  async listByTenant(tenantId: string, workspaceId: string): Promise<SharedCustomerProfile[]> {
    const rows = await this.prisma.customerProfile.findMany({
      where: { tenantId },
      include: { workspaceLinks: { where: { workspaceId } } },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.toDomain(row));
  }

  async findById(tenantId: string, customerId: string, workspaceId?: string): Promise<SharedCustomerProfile | undefined> {
    const row = await this.prisma.customerProfile.findFirst({
      where: { id: customerId, tenantId },
      include: {
        workspaceLinks: workspaceId ? { where: { workspaceId } } : false,
        // CUSTOMER-01E：详情才带联系人与经办人；列表不带，避免 N+1 且列表并不展示它们。
        contacts: { where: { status: "active" }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        authorizedAgents: { orderBy: { validFrom: "desc" } }
      }
    });
    return row ? this.toDomain(row) : undefined;
  }

  /** 按手机号查主档。用于「客户已在别的空间注册过」的复用判定。 */
  async findByPhone(tenantId: string, phone: string, workspaceId?: string): Promise<SharedCustomerProfile | undefined> {
    const row = await this.prisma.customerProfile.findFirst({
      where: { tenantId, phone: phone.trim() },
      include: { workspaceLinks: workspaceId ? { where: { workspaceId } } : false }
    });
    return row ? this.toDomain(row) : undefined;
  }

  /**
   * 创建共享客户主档，并在同一事务里把它接入指定经营空间。
   *
   * 两件事必须同事务：主档建好而关系没建，客户在当前空间"不存在"却又占用了
   * 手机号唯一键，再次创建会撞 409 且无从修复。
   */
  async createWithLink(
    tenantId: string,
    workspaceId: string,
    input: SaveSharedCustomerRequest,
    levelName: string
  ): Promise<SharedCustomerProfile> {
    const created = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.customerProfile.create({
        data: {
          tenantId,
          customerType: input.customerType,
          name: input.name.trim(),
          phone: input.phone.trim(),
          phoneMasked: this.mask(input.phone),
          email: input.email?.trim() || null,
          identityVerified: input.identityVerified ?? false,
          // 只存掩码，绝不落明文证件号。
          identityNoMasked: input.identityNo ? this.mask(input.identityNo) : null,
          qualifications: (input.qualifications ?? {}) as Prisma.InputJsonValue,
          corporateName: input.corporateName?.trim() || null,
          corporateTaxNo: input.corporateTaxNo?.trim() || null
        }
      });
      await tx.customerWorkspaceLink.create({
        data: { tenantId, workspaceId, customerId: profile.id, levelName }
      });
      return profile.id;
    });
    const profile = await this.findById(tenantId, created, workspaceId);
    if (!profile) throw new Error("共享客户创建后读取失败");
    return profile;
  }

  /**
   * 把已存在的共享客户接入某个经营空间。幂等：已接入则返回既有关系。
   *
   * 这是「同一客户无需重复注册即可在两个空间使用」的落点。
   */
  async linkToWorkspace(
    tenantId: string,
    workspaceId: string,
    customerId: string,
    levelName: string
  ): Promise<CustomerWorkspaceLink> {
    const existing = await this.prisma.customerWorkspaceLink.findFirst({
      where: { tenantId, workspaceId, customerId }
    });
    if (existing) return this.toLink(existing);
    try {
      const row = await this.prisma.customerWorkspaceLink.create({
        data: { tenantId, workspaceId, customerId, levelName }
      });
      return this.toLink(row);
    } catch (error) {
      // 两个请求可能同时越过上面的查询；唯一约束是最终裁决。撞键后读取
      // 已提交关系，保持“接入客户”语义幂等，而不是向调用方暴露 500。
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const winner = await this.prisma.customerWorkspaceLink.findFirst({
        where: { tenantId, workspaceId, customerId }
      });
      if (!winner) throw error;
      return this.toLink(winner);
    }
  }

  /** 列出**当前空间**的客户关系。与主档列表刻意分开，避免把跨空间可见误用到业务侧。 */
  async listLinksByWorkspace(tenantId: string, workspaceId: string): Promise<CustomerWorkspaceLink[]> {
    const rows = await this.prisma.customerWorkspaceLink.findMany({
      where: { tenantId, workspaceId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.toLink(row));
  }

  async findLink(
    tenantId: string,
    workspaceId: string,
    customerId: string
  ): Promise<CustomerWorkspaceLink | undefined> {
    const row = await this.prisma.customerWorkspaceLink.findFirst({
      where: { tenantId, workspaceId, customerId }
    });
    return row ? this.toLink(row) : undefined;
  }

  private toDomain(row: {
    id: string;
    tenantId: string;
    customerType: string;
    name: string;
    phone: string;
    phoneMasked: string;
    email: string | null;
    identityVerified: boolean;
    identityNoMasked: string | null;
    qualifications: Prisma.JsonValue;
    corporateName: string | null;
    corporateTaxNo: string | null;
    status: string;
    sourceMemberId: string | null;
    mergedIntoCustomerId: string | null;
    createdAt: Date;
    updatedAt: Date;
    workspaceLinks?: Array<Parameters<SharedCustomerRepository["toLinkPublic"]>[0]>;
    contacts?: Array<{
      id: string; kind: string; name: string; phoneMasked: string;
      relation: string | null; isPrimary: boolean; status: string; linkedCustomerId: string | null;
    }>;
    authorizedAgents?: Array<{
      id: string; agentName: string; agentPhoneMasked: string; authorityScope: Prisma.JsonValue;
      validFrom: Date; validTo: Date | null; status: string;
    }>;
  }): SharedCustomerProfile {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerType: row.customerType as SharedCustomerProfile["customerType"],
      name: row.name,
      phone: row.phone,
      phoneMasked: row.phoneMasked,
      email: row.email ?? undefined,
      identityVerified: row.identityVerified,
      identityNoMasked: row.identityNoMasked ?? undefined,
      qualifications: (row.qualifications ?? {}) as Record<string, unknown>,
      corporateName: row.corporateName ?? undefined,
      corporateTaxNo: row.corporateTaxNo ?? undefined,
      status: row.status as SharedCustomerProfile["status"],
      sourceMemberId: row.sourceMemberId ?? undefined,
      // CUSTOMER-01A/B：必须带出来。少了它，`assertTransactable` 永远读到 undefined，
      // 已被合并的主档会继续通过下单判定——实测踩过，由 01B 专项用例抓到。
      mergedIntoCustomerId: row.mergedIntoCustomerId ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      workspaceLinks: row.workspaceLinks?.map((link) => this.toLink(link)),
      // CUSTOMER-01E：仅详情查询带这两个关联；列表不带，故为 undefined。
      // 号码一律只给脱敏值——明文由服务层按解密权限单独决定并留访问审计。
      contacts: row.contacts?.map((contact) => ({
        id: contact.id,
        kind: contact.kind as "emergency" | "corporate" | "other",
        name: contact.name,
        phoneMasked: contact.phoneMasked,
        relation: contact.relation ?? undefined,
        isPrimary: contact.isPrimary,
        status: contact.status,
        linkedCustomerId: contact.linkedCustomerId ?? undefined
      })),
      authorizedAgents: row.authorizedAgents?.map((agent) => ({
        id: agent.id,
        agentName: agent.agentName,
        agentPhoneMasked: agent.agentPhoneMasked,
        authorityScope: (agent.authorityScope ?? {}) as Record<string, unknown>,
        validFrom: agent.validFrom.toISOString(),
        validTo: agent.validTo?.toISOString(),
        status: agent.status
      }))
    };
  }

  /** 仅用于给 toDomain 的入参推导类型，不在运行时调用。 */
  private toLinkPublic(row: {
    id: string;
    tenantId: string;
    workspaceId: string;
    customerId: string;
    levelName: string;
    status: string;
    firstOrderAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return row;
  }

  private toLink(row: {
    id: string;
    tenantId: string;
    workspaceId: string;
    customerId: string;
    levelName: string;
    status: string;
    firstOrderAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): CustomerWorkspaceLink {
    return {
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      customerId: row.customerId,
      levelName: row.levelName,
      status: row.status as CustomerWorkspaceLink["status"],
      firstOrderAt: row.firstOrderAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}

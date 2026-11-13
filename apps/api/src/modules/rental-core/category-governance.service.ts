/** Rental definition drafts, immutable publication and separate adoption policy.
 * Requests are detached before waits so keys, writes and audits share one input.
 * Writes reuse original platform identity/permission reads in one transaction;
 * tenant business facts and production enablement remain outside this service. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { CATEGORY_DRAFT_SECTIONS, CATEGORY_GOVERNANCE_PERMISSIONS as P, RENTAL_CAPABILITY_MODULES, RENTAL_CORE_CAPABILITY_CODES, RENTAL_PRICING_UNIT_CODES, isRentalCategoryCode,
  type RentalCategoryCode,
  type PreviewRentalCategoryCreationRequest, type CreateRentalCategoryRequest, type RentalCategoryCreationReceipt, type CategoryVersionView,
  type ArchiveCategoryDraftRequest, type CategoryDraftSection, type CreateCategoryDraftRequest, type PatchCategoryDraftRequest,
  type PublishCategoryDraftRequest, type SaveCategoryOpeningRequest, type SaveCategoryVersionPolicyRequest, type SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { parsePublishedRentalCategory } from "./rental-category-resolver.service";
import { rentalPricingStrategyReference } from "./rental-pricing-strategy";
import { categoryScopeAllows } from "./category-governance-policy";
import { categoryDefinitionDifferences } from "./category-definition-diff";
import { categoryCreationTemplates, composeCategoryCreation } from "./category-creation-templates";
import { requestFingerprint } from "./rental-idempotency.repository";
import { AuthService } from "../auth/auth.service";
import { PlatformRepository } from "../platform/platform.repository";

export function assertCategoryGovernancePermission(user: SystemUserRow | undefined, permission: string) {
  if (!user?.isSaasAdmin || !(user.permissions.includes(permission) || user.permissions.includes("*"))) {
    throw new ForbiddenException(`平台品类操作需要 SaaS 身份及权限：${permission}`);
  }
}
const sections: Record<CategoryDraftSection, Record<string, string[]>> = {
  basic: { root: ["name", "description", "terminology", "display"] },
  attributes: { root: ["attributeSchema"], business: ["assetFields", "catalogPresentation"] },
  inventory: { root: ["supportedInventoryModes"], business: ["fulfillmentModes", "locationTypes", "deliveryDestination"] },
  pricing: { business: ["pricingUnits", "defaultPricingUnit", "settingModules", "supportsHolidayPricing", "supportsUsagePricing", "supportsPreauthorization"], defaults: ["payment", "overdue", "fulfillment"] },
  inspection: { business: ["supportsQualificationReview"], defaults: ["rules", "inspectionFields"] },
  capabilities: { root: ["defaultCapabilities", "requiredCapabilities", "conditionalCapabilities"], business: ["valueAddedServicePresets"] }
};
export function patchCategorySection(body: unknown, section: CategoryDraftSection, values: Record<string, unknown>) {
  const ownership = sections[section];
  if (!ownership || !values || Array.isArray(values) || typeof values !== "object" || !Object.keys(values).length) throw new BadRequestException("草稿页签或输入为空");
  const allowed = Object.values(ownership).flat();
  if (Object.keys(values).some((key) => !allowed.includes(key))) throw new BadRequestException("本页不能修改其他页签或核心身份字段");
  const encoded = JSON.stringify(values);
  if (Buffer.byteLength(encoded) > 256 * 1024) throw new BadRequestException("草稿补丁超过 256 KiB");
  const rejectUnsafe = (input: unknown, depth = 0): void => {
    if (depth > 16) throw new BadRequestException("配置嵌套过深");
    if (input && typeof input === "object") for (const [key, value] of Object.entries(input)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new BadRequestException("配置包含不安全字段");
      rejectUnsafe(value, depth + 1);
    }
  };
  rejectUnsafe(values);
  const candidate = structuredClone(body) as any;
  for (const [scope, keys] of Object.entries(ownership)) for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    if (values[key] === null) throw new BadRequestException("本页字段不支持 null 清空");
    const target = scope === "root" ? candidate : scope === "business" ? candidate.businessModel : candidate.businessModel.defaults;
    target[key] = structuredClone(values[key]);
  }
  if (Buffer.byteLength(JSON.stringify(candidate)) > 256 * 1024) throw new BadRequestException("品类正文超过 256 KiB");
  return candidate;
}
const categoryIdentity = (code: string): RentalCategoryCode => {
  if (!isRentalCategoryCode(code)) throw new BadRequestException("品类编码必须为 2～64 位小写字母、数字或下划线，并以字母开头");
  return code;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class CategoryGovernanceService {
  constructor(private readonly prisma: PrismaService, private readonly hooks: CapabilityHookRuntime,
    @Optional() private readonly auth?: AuthService, @Optional() private readonly principals?: PlatformRepository) {}

  /** Original signed platform session and permission mapping under Serializable.
   * Identity/role reads precede category locks and are checked again before return.
   * No bearer token is stored, no workspace grant is inferred, and no write retries. */
  private async platformTransaction<T>(user: SystemUserRow, permission: string, authorization: string | undefined,
    run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    assertCategoryGovernancePermission(user, permission);
    if (!this.auth || !this.principals) throw new ServiceUnavailableException("平台品类事务缺少原身份复核接点");
    const auth = this.auth, principals = this.principals;
    const signal = AbortSignal.timeout(30000);
    try {
      return await this.prisma.$transaction(async tx => {
        const before = await auth.resolveTrustedPlatformBrowserPrincipal(authorization, tx, signal);
        if (!before || before.userId !== user.id || before.tenantId !== user.tenantId) throw new UnauthorizedException("当前平台会话与品类操作人不一致");
        assertCategoryGovernancePermission(await principals.findUserById(before.userId, tx), permission);
        if (signal.aborted || before.expiresAt <= Math.floor(Date.now() / 1000)) throw new UnauthorizedException("平台会话已到期，品类写入未获准");
        const result = await run(tx);
        const after = await auth.resolveTrustedPlatformBrowserPrincipal(authorization, tx, signal);
        if (!after || after.userId !== before.userId || after.tenantId !== before.tenantId ||
            after.sessionId !== before.sessionId || after.expiresAt !== before.expiresAt ||
            user.id !== before.userId || user.tenantId !== before.tenantId) throw new UnauthorizedException("平台会话在品类操作期间变化，请核对原结果");
        assertCategoryGovernancePermission(await principals.findUserById(before.userId, tx), permission);
        // Permission reads may wait too; expiry must be checked after the last await.
        if (signal.aborted || after.expiresAt <= Math.floor(Date.now() / 1000)) throw new UnauthorizedException("平台会话已到期，请核对原品类操作结果");
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("平台身份或品类请求发生并发冲突，请保留原输入核对原结果");
      }
      throw error;
    }
  }
  private dynamicCreationEnabled() {
    return process.env.NODE_ENV !== "production" && process.env.RENTAL_CATEGORY_DYNAMIC_CREATION === "true";
  }
  private creationKey(user: SystemUserRow, key: string) {
    if (!/^[A-Za-z0-9._:-]{8,128}(?![\s\S])/u.test(key)) throw new BadRequestException("新品类原操作键格式无效");
    return `category-create:${requestFingerprint({ actorId: user.id, key })}`;
  }
  private async creationSource(db: Prisma.TransactionClient | PrismaService, input: PreviewRentalCategoryCreationRequest) {
    if (Boolean(input.templateId) === Boolean(input.sourceVersionId)) throw new BadRequestException("请选择一个模板或一个来源发布版本");
    if (input.templateId) {
      const template = categoryCreationTemplates().find(template => template.id === input.templateId);
      if (!template) throw new BadRequestException("模板不存在");
      return { definition: template.definition, sourceKind: `template:${template.id}@1` };
    }
    const source = await db.rentalCategoryVersion.findUnique({ where: { id: input.sourceVersionId! } });
    if (!source || !["published", "legacy_baseline"].includes(source.status)) throw new BadRequestException("复制来源必须是已有发布版本");
    return { definition: parsePublishedRentalCategory(source.definition, source.categoryCode), sourceKind: "category_copy" };
  }
  async previewCreation(input: PreviewRentalCategoryCreationRequest, user: SystemUserRow) {
    assertCategoryGovernancePermission(user, P.edit);
    input = structuredClone(input);
    const source = await this.creationSource(this.prisma, input);
    const preview = composeCategoryCreation(source.definition, input);
    const validation = this.validation(preview.definition, input.code);
    const exists = await this.prisma.rentalCategoryDefinition.findUnique({ where: { code: input.code }, select: { code: true } });
    return { ...preview, valid: validation.valid && !exists, errors: [...validation.errors, ...(exists ? ["品类编码已被占用，不能重用"] : [])], previewOnly: true as const };
  }
  private async creationReceipt(db: Prisma.TransactionClient | PrismaService, user: SystemUserRow, key: string, expectedHash?: string) {
    const audit = await db.rentalCategoryGovernanceAudit.findUnique({ where: { id: this.creationKey(user, key) } });
    if (!audit) return undefined;
    const after = audit.after as unknown as { requestHash?: string; version?: CategoryVersionView } | null;
    if (audit.action !== "category_create" || audit.actorId !== user.id || !after?.requestHash || !after.version || after.version.categoryCode !== audit.categoryCode) {
      throw new ConflictException("新品类原收据缺少可核对的创建依据");
    }
    if (expectedHash && expectedHash !== after.requestHash) throw new ConflictException("原操作键已用于不同新品类输入，请先核对原收据");
    return after.version;
  }
  async readCreationReceipt(key: string, user: SystemUserRow, authorization?: string): Promise<RentalCategoryCreationReceipt> {
    return this.platformTransaction<RentalCategoryCreationReceipt>(user, P.edit, authorization, async tx => {
      const version = await this.creationReceipt(tx, user, key);
      return version ? { outcome: "created", version } : { outcome: "unknown" };
    });
  }
  async createCategory(input: CreateRentalCategoryRequest, user: SystemUserRow, authorization?: string) {
    assertCategoryGovernancePermission(user, P.edit);
    categoryIdentity(input.code);
    if (!input.reason?.trim() || input.reason.length > 512) throw new BadRequestException("请填写创建原因");
    input = structuredClone(input);
    const requestHash = requestFingerprint(input);
    try {
      return await this.platformTransaction(user, P.edit, authorization, async tx => {
        const replay = await this.creationReceipt(tx, user, input.idempotencyKey, requestHash);
        if (replay) return replay;
        if (!this.dynamicCreationEnabled()) throw new ServiceUnavailableException("动态品类创建尚未开放");
        const source = await this.creationSource(tx, input);
        const composed = composeCategoryCreation(source.definition, input);
        if (composed.definitionHash !== input.expectedDefinitionHash) throw new ConflictException("创建内容与已核对预览不同，请重新预览");
        const validation = this.validation(composed.definition, input.code);
        if (!validation.valid) throw new ConflictException(validation.errors.join("；"));
        if (await tx.rentalCategoryDefinition.findUnique({ where: { code: input.code }, select: { code: true } })) throw new ConflictException("品类编码已被占用，不能重用");
        const definition = composed.definition;
        await tx.rentalCategoryDefinition.create({ data: { code: input.code, name: definition.name, description: definition.description,
          supportedInventoryModes: definition.supportedInventoryModes, defaultCapabilities: definition.defaultCapabilities,
          terminology: JSON.parse(JSON.stringify(definition.terminology)), attributeSchema: JSON.parse(JSON.stringify(definition.attributeSchema)),
          businessModel: JSON.parse(JSON.stringify(definition.businessModel)), version: definition.version,
          openingScope: "unopened", openingTenantIds: [], openingRevision: 0 } });
        const row = await tx.rentalCategoryVersion.create({ data: { id: randomUUID(), categoryCode: input.code, versionLabel: input.versionLabel,
          sourceVersionId: input.sourceVersionId, sourceKind: source.sourceKind, status: "draft", revision: 0, structureVersion: 1,
          definition: JSON.parse(JSON.stringify(composed.definition)) } });
        const version = JSON.parse(JSON.stringify(row)) as CategoryVersionView;
        await this.audit(tx, input.code, row.id, "category_create", user, input.reason, undefined, { requestHash, version }, this.creationKey(user, input.idempotencyKey));
        return version;
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        const replay = await this.platformTransaction(user, P.edit, authorization,
          tx => this.creationReceipt(tx, user, input.idempotencyKey, requestHash));
        if (replay) return replay;
        throw new ConflictException("品类编码或原操作键已被并发占用，请核对原收据");
      }
      throw error;
    }
  }
  private audit(tx: Prisma.TransactionClient, code: RentalCategoryCode, versionId: string | undefined, action: string, user: SystemUserRow, reason: string, before: unknown, after: unknown, id: string = randomUUID()) {
    if (!reason?.trim() || reason.length > 512) throw new BadRequestException("必须填写变更原因（最多 512 字）");
    return tx.rentalCategoryGovernanceAudit.create({ data: { id, categoryCode: code, versionId, action, actorId: user.id, reason: reason.trim(),
      before: before === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(before)),
      after: after === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(after)) } });
  }
  private async lockedCategory(tx: Prisma.TransactionClient, code: RentalCategoryCode) {
    await tx.$queryRaw(Prisma.sql`SELECT code FROM rental_category_definitions WHERE code = ${code.toLowerCase()} FOR UPDATE`);
    const row = await tx.rentalCategoryDefinition.findUnique({ where: { code } });
    if (!row) throw new NotFoundException("租赁品类不存在");
    return row;
  }
  private async version(db: Prisma.TransactionClient | PrismaService, code: RentalCategoryCode, id: string) {
    const row = await db.rentalCategoryVersion.findFirst({ where: { id, categoryCode: code }, include: { policy: true } });
    if (!row) throw new NotFoundException("品类版本不存在");
    return row;
  }
  private async tenants(tx: Prisma.TransactionClient, scope: string, ids: string[]) {
    if (!Array.isArray(ids) || ids.length > 200 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 191)) throw new BadRequestException("试点租户名单不合法");
    if ((scope === "pilot") !== (ids.length > 0)) throw new BadRequestException("仅试点范围必须且可以配置租户名单");
    if (ids.length && await tx.tenant.count({ where: { id: { in: ids } } }) !== ids.length) throw new BadRequestException("试点名单包含不存在的租户");
  }
  async list(user: SystemUserRow) {
    assertCategoryGovernancePermission(user, P.view);
    const rows = await this.prisma.rentalCategoryDefinition.findMany({ include: { versions: { select: { id: true, status: true, versionLabel: true, publishedAt: true, definition: true } } }, orderBy: { code: "asc" } });
    return Promise.all(rows.map(async (row) => {
      const workspaces = await this.prisma.businessWorkspace.findMany({ where: { categoryCode: row.code }, select: { tenantId: true } });
      const published = row.versions.filter((v) => ["published", "legacy_baseline"].includes(v.status)).sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
      const recommended = row.versions.find((version) => version.id === row.recommendedVersionId);
      const body = recommended?.definition as unknown as { name?: string; display?: { nameEn?: string; icon?: string } } | undefined;
      return { code: row.code.toLowerCase(), name: body?.name ?? row.name, nameEn: body?.display?.nameEn, icon: body?.display?.icon,
        openingScope: row.openingScope, openingTenantIds: row.openingTenantIds ?? [], openingRevision: row.openingRevision,
        recommendedVersionId: row.recommendedVersionId, recommendedVersionLabel: row.versions.find((v) => v.id === row.recommendedVersionId)?.versionLabel ?? null,
        latestPublished: published[0] ? { id: published[0].id, status: published[0].status, versionLabel: published[0].versionLabel, publishedAt: published[0].publishedAt } : null,
        drafts: row.versions.filter((v) => v.status === "draft").map((v) => ({ id: v.id, status: v.status, versionLabel: v.versionLabel })),
        adoptedSpaces: workspaces.length, adoptedTenants: new Set(workspaces.map((w) => w.tenantId)).size };
    }));
  }
  async tenantDirectory(user: SystemUserRow) {
    assertCategoryGovernancePermission(user, P.view);
    return this.prisma.tenant.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" }, take: 1000 });
  }
  async detail(code: string, user: SystemUserRow) {
    assertCategoryGovernancePermission(user, P.view);
    const row = await this.prisma.rentalCategoryDefinition.findUnique({ where: { code: categoryIdentity(code) }, select: { code: true, name: true, openingScope: true, openingTenantIds: true, openingRevision: true, recommendedVersionId: true } });
    if (!row) throw new NotFoundException("租赁品类不存在");
    const versions = await this.prisma.rentalCategoryVersion.findMany({ where: { categoryCode: row.code }, include: { policy: true }, orderBy: { createdAt: "desc" }, take: 100 });
    return { ...row, code, versions: versions.map((v) => ({ ...v, categoryCode: code })) };
  }
  async candidates(code: string, tenantId: string, operation: string, user: SystemUserRow) {
    assertCategoryGovernancePermission(user, P.view);
    if (!["create", "upgrade", "restore"].includes(operation)) throw new BadRequestException("未知采用动作");
    const categoryCode = categoryIdentity(code);
    const category = await this.prisma.rentalCategoryDefinition.findUnique({ where: { code: categoryCode } });
    if (!category) throw new NotFoundException("租赁品类不存在");
    if (operation === "create" && !categoryScopeAllows(category.openingScope, category.openingTenantIds, tenantId)) return [];
    const rows = await this.prisma.rentalCategoryVersion.findMany({ where: { categoryCode, status: { in: ["published", "legacy_baseline"] } }, include: { policy: true } });
    const op = operation as "create" | "upgrade" | "restore";
    return rows.filter((row) => row.policy && categoryScopeAllows(row.policy[`${op}Scope`], row.policy[`${op}TenantIds`], tenantId))
      .map((row) => ({ id: row.id, versionLabel: row.versionLabel, operation: op }));
  }
  async createDraft(code: string, input: CreateCategoryDraftRequest, user: SystemUserRow, authorization?: string) {
    assertCategoryGovernancePermission(user, P.edit);
    input = structuredClone(input);
    const categoryCode = categoryIdentity(code);
    try { return await this.platformTransaction(user, P.edit, authorization, async (tx) => {
      await this.lockedCategory(tx, categoryCode);
      const source = await this.version(tx, categoryCode, input.sourceVersionId);
      if (!["published", "legacy_baseline"].includes(source.status)) throw new ConflictException("只能从同品类已发布版本复制新草稿");
      const definition = structuredClone(source.definition) as any;
      definition.version = input.versionLabel;
      const created = await tx.rentalCategoryVersion.create({ data: { id: `catv_${randomUUID()}`, categoryCode, versionLabel: input.versionLabel,
        structureVersion: source.structureVersion, sourceVersionId: source.id, sourceKind: "platform_copy", status: "draft", definition } });
      await this.audit(tx, categoryCode, created.id, "draft_create", user, input.reason, undefined, { sourceVersionId: source.id, revision: 0 });
      return created;
    }); } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("该品类版本号已存在，请使用新的版本号");
      throw error;
    }
  }
  async patchDraft(code: string, id: string, section: CategoryDraftSection, input: PatchCategoryDraftRequest, user: SystemUserRow, authorization?: string) {
    assertCategoryGovernancePermission(user, P.edit);
    if (!CATEGORY_DRAFT_SECTIONS.includes(section)) throw new BadRequestException("未知草稿页签");
    input = structuredClone(input);
    const categoryCode = categoryIdentity(code);
    return this.platformTransaction(user, P.edit, authorization, async (tx) => {
      const row = await this.version(tx, categoryCode, id);
      if (row.status !== "draft" || row.revision !== input.expectedRevision) throw new ConflictException("草稿已变更或不是可编辑状态，请刷新后核对");
      const definition = patchCategorySection(row.definition, section, input.values);
      const changed = await tx.rentalCategoryVersion.updateMany({ where: { id, categoryCode, status: "draft", revision: input.expectedRevision }, data: { definition, revision: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("其他管理员已修改草稿，本次未覆盖其输入");
      await this.audit(tx, categoryCode, id, "draft_patch", user, input.reason, { revision: row.revision }, { revision: row.revision + 1, section, digest: digest(definition) });
      return this.version(tx, categoryCode, id);
    });
  }
  async validate(code: string, id: string, user: SystemUserRow) {
    assertCategoryGovernancePermission(user, P.view);
    const row = await this.version(this.prisma, categoryIdentity(code), id);
    return this.validation(row.definition, code);
  }
  private validation(body: unknown, code: string) {
    try {
      const definition = parsePublishedRentalCategory(body, code);
      this.hooks.assertCategoryComposition(definition);
      const versions = new Set(this.hooks.registeredVersions());
      const hookCodes = new Set(this.hooks.registeredCodes());
      const capabilities = definition.defaultCapabilities.map((name) => {
        const module = RENTAL_CAPABILITY_MODULES.find((entry) => entry.code === name)!;
        if (!module.implementationVersion || (hookCodes.has(name) && !versions.has(`${name}@${module.implementationVersion}`))) throw new ConflictException(`能力 ${module.label} 尚无可执行的声明版本`);
        return { code: name, implementationVersion: module.implementationVersion };
      });
      return { valid: true, errors: [] as string[], dependencyDigest: { capabilities, pricingStrategies: definition.businessModel.pricingUnits.map(rentalPricingStrategyReference), structureVersion: 1 } };
    } catch (error) { return { valid: false, errors: [error instanceof Error ? error.message : "品类配置不合法"], dependencyDigest: null }; }
  }
  async preview(code: string, id: string, user: SystemUserRow) {
    assertCategoryGovernancePermission(user, P.view);
    const row = await this.version(this.prisma, categoryIdentity(code), id);
    const source = row.sourceVersionId ? await this.prisma.rentalCategoryVersion.findUnique({ where: { id: row.sourceVersionId } }) : undefined;
    if (row.sourceVersionId && (!source || !["published", "legacy_baseline"].includes(source.status))) throw new ConflictException("草稿来源发布版本缺失，不能伪造差异依据");
    const before = source?.definition as any;
    const body = row.definition as any;
    return { ...this.validation(body, code), previewOnly: true, revision: row.revision, sourceVersionId: row.sourceVersionId,
      differences: categoryDefinitionDifferences(before, body),
      changedSections: CATEGORY_DRAFT_SECTIONS.filter((section) => Object.entries(sections[section]).some(([scope, keys]) => keys.some((key) => {
        const read = (value: any) => scope === "root" ? value?.[key] : scope === "business" ? value?.businessModel?.[key] : value?.businessModel?.defaults?.[key];
        return JSON.stringify(read(body)) !== JSON.stringify(read(before));
      }))), itemFields: body?.businessModel?.assetFields ?? [], inspectionFields: body?.businessModel?.defaults?.inspectionFields ?? [],
      affectedSpaces: await this.prisma.businessWorkspace.count({ where: { categoryCode: row.categoryCode } }) };
  }
  async publish(code: string, id: string, input: PublishCategoryDraftRequest, user: SystemUserRow, authorization?: string) {
    assertCategoryGovernancePermission(user, P.publish);
    input = structuredClone(input);
    const categoryCode = categoryIdentity(code);
    return this.platformTransaction(user, P.publish, authorization, async (tx) => {
      await this.lockedCategory(tx, categoryCode);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM rental_category_versions WHERE id = ${id} AND categoryCode = ${categoryCode.toLowerCase()} FOR UPDATE`);
      const row = await this.version(tx, categoryCode, id);
      if (row.status === "published") {
        const audit = await tx.rentalCategoryGovernanceAudit.findUnique({ where: { id: `publish:${id}` } });
        const after = audit?.after as any;
        if (after?.idempotencyKey === input.idempotencyKey && after?.expectedRevision === input.expectedRevision && audit?.reason === input.reason.trim()) return row;
        throw new ConflictException("该版本已经发布；只有同请求重试可返回原结果");
      }
      if (row.status !== "draft" || row.revision !== input.expectedRevision) throw new ConflictException("草稿已变更或归档，请重新校验");
      const validation = this.validation(row.definition, code);
      if (!validation.valid) throw new ConflictException({ message: "发布校验失败", errors: validation.errors });
      const changed = await tx.rentalCategoryVersion.updateMany({ where: { id, status: "draft", revision: input.expectedRevision }, data: { status: "published", revision: { increment: 1 }, publishedAt: new Date(), publishedBy: user.id, publishReason: input.reason.trim(), dependencyDigest: validation.dependencyDigest as Prisma.InputJsonValue } });
      if (changed.count !== 1) throw new ConflictException("草稿在发布期间变化，请重新校验");
      // New versions are closed until an explicit, separately audited policy decision.
      await tx.rentalCategoryVersionPolicy.create({ data: { versionId: id, createScope: "none", createTenantIds: [], upgradeScope: "none", upgradeTenantIds: [], restoreScope: "none", restoreTenantIds: [] } });
      await this.audit(tx, categoryCode, id, "publish", user, input.reason, { revision: row.revision }, { idempotencyKey: input.idempotencyKey, expectedRevision: input.expectedRevision, digest: digest(row.definition) }, `publish:${id}`);
      return this.version(tx, categoryCode, id);
    });
  }
  async archive(code: string, id: string, input: ArchiveCategoryDraftRequest, user: SystemUserRow, authorization?: string) {
    assertCategoryGovernancePermission(user, P.edit);
    input = structuredClone(input);
    return this.platformTransaction(user, P.edit, authorization, async (tx) => {
      const categoryCode = categoryIdentity(code);
      const changed = await tx.rentalCategoryVersion.updateMany({ where: { id, categoryCode, revision: input.expectedRevision, status: "draft" }, data: { status: "archived", revision: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("只能归档当前修订的未发布草稿");
      await this.audit(tx, categoryCode, id, "draft_archive", user, input.reason, { revision: input.expectedRevision }, { revision: input.expectedRevision + 1 });
      return this.version(tx, categoryCode, id);
    });
  }
  async opening(code: string, input: SaveCategoryOpeningRequest, user: SystemUserRow, authorization?: string) {
    assertCategoryGovernancePermission(user, P.opening);
    input = structuredClone(input);
    const categoryCode = categoryIdentity(code);
    return this.platformTransaction(user, P.opening, authorization, async (tx) => {
      const category = await this.lockedCategory(tx, categoryCode);
      if (category.openingRevision !== input.expectedRevision) throw new ConflictException("品类开通政策已变更");
      await this.tenants(tx, input.scope, input.tenantIds);
      const versionId = input.recommendedVersionId ?? category.recommendedVersionId;
      if (["all", "pilot"].includes(input.scope)) {
        if (!versionId) throw new ConflictException("开放前必须明确推荐发布版本");
        const target = await this.version(tx, categoryCode, versionId);
        if (!["published", "legacy_baseline"].includes(target.status) || !this.validation(target.definition, code).valid || !target.policy || target.policy.createScope === "none") throw new ConflictException("推荐版本尚未满足执行与新建采用条件");
      } else if (input.recommendedVersionId) {
        const target = await this.version(tx, categoryCode, versionId!);
        if (!["published", "legacy_baseline"].includes(target.status)) throw new ConflictException("推荐引用只能指向本品类发布版本");
      }
      const after = { openingScope: input.scope, openingTenantIds: input.tenantIds, recommendedVersionId: versionId, openingRevision: category.openingRevision + 1 };
      await tx.rentalCategoryDefinition.update({ where: { code: categoryCode }, data: after });
      await this.audit(tx, categoryCode, undefined, "opening_policy", user, input.reason, { openingScope: category.openingScope, openingTenantIds: category.openingTenantIds, openingRevision: category.openingRevision, recommendedVersionId: category.recommendedVersionId }, after);
      return after;
    });
  }
  async policy(code: string, id: string, input: SaveCategoryVersionPolicyRequest, user: SystemUserRow, authorization?: string) {
    assertCategoryGovernancePermission(user, P.publish);
    input = structuredClone(input);
    const categoryCode = categoryIdentity(code);
    return this.platformTransaction(user, P.publish, authorization, async (tx) => {
      await this.lockedCategory(tx, categoryCode);
      const row = await this.version(tx, categoryCode, id);
      if (!["published", "legacy_baseline"].includes(row.status) || !row.policy) throw new ConflictException("只能维护已发布版本的独立采用政策");
      if (row.policy.revision !== input.expectedRevision) throw new ConflictException("版本采用政策已变更");
      for (const op of ["create", "upgrade", "restore"] as const) await this.tenants(tx, input[`${op}Scope`], input[`${op}TenantIds`]);
      const { expectedRevision, reason, ...values } = input;
      const changed = await tx.rentalCategoryVersionPolicy.updateMany({ where: { versionId: id, revision: expectedRevision }, data: { ...values, revision: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("版本采用政策发生并发变更");
      await this.audit(tx, categoryCode, id, "version_policy", user, reason, row.policy, { ...values, revision: expectedRevision + 1 });
      return this.version(tx, categoryCode, id);
    });
  }
  async audits(code: string, user: SystemUserRow) {
    assertCategoryGovernancePermission(user, P.audit);
    return this.prisma.rentalCategoryGovernanceAudit.findMany({ where: { categoryCode: categoryIdentity(code) }, orderBy: { createdAt: "desc" }, take: 100 });
  }
  catalog(user: SystemUserRow) {
    assertCategoryGovernancePermission(user, P.view);
    const provided = new Set<string>(RENTAL_CORE_CAPABILITY_CODES);
    const versions = new Set(this.hooks.registeredVersions());
    return { structureVersion: 1, dynamicCreationEnabled: this.dynamicCreationEnabled(), templates: categoryCreationTemplates(), capabilities: structuredClone(RENTAL_CAPABILITY_MODULES).map((entry) => {
      const expectsHook = !provided.has(entry.code) && entry.extensionPoints.some(point => point === "order_validation" || point === "fulfillment");
      return { ...entry, implemented: Boolean(entry.implementationVersion && (!expectsHook || versions.has(`${entry.code}@${entry.implementationVersion}`))),
        composition: entry.implementationVersion ? this.hooks.compositionFor(entry.code, entry.implementationVersion) : undefined };
    }),
      pricingStrategies: RENTAL_PRICING_UNIT_CODES.map(rentalPricingStrategyReference) };
  }
}

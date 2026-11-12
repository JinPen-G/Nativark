/** Rental preparation and own-receipt reads. Owns authorization/revision
 * transactions; never activates staged entities, capabilities or bindings. */
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { CATEGORY_PREPARATION_LIMITS, RENTAL_CAPABILITY_CODES, type CategoryCapabilityPreparationPatch, type CategoryEntityPreparationPatch, type CategoryPreparationBatchReadResult, type CategoryPreparationEntitiesQuery, type CategoryPreparationEntityPage, type CategoryPreparationSaveResult, type RentalCapability, type RentalCapabilityConfig, type RentalCapabilityLifecycleStatus, type SaveCategoryPreparationBatchRequest, type SaveCategoryPreparationRequest, type SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { requireRequestWorkspaceId } from "../../common/request-identity";
import { assertCategoryAdoptionAllowed, categoryScopeAllows } from "./category-governance-policy";
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { prepareCategoryAdoptionRecords } from "./category-adoption-records";
import { categoryDefinitionDifferences } from "./category-definition-diff";
import { readCategoryAdoptionCompatibility } from "./category-adoption-compatibility-reader";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { SubscriptionService } from "../subscription/subscription.service";
import { categoryCommercialCompatibility, categoryCommercialRequirements } from "./category-adoption-commercial";
import { assertCategoryPreparationBatchSize, categoryPreparationBatchFingerprint, mergeCategoryPreparationBatch, readCategoryPreparationBatchResult } from "./category-preparation-batches";
import type { CategoryPreparationPreview } from "@rental-os/shared";
import { AuthService } from "../auth/auth.service";
import { CategoryAdoptionApplication } from "./category-adoption.application";
import { readFinalCategoryAdoptionCompatibility } from "./category-adoption-final-compatibility";
import { assertCategoryPreparationPermission, lockCategoryAdoptionAccess } from "./category-adoption-access";
export { CATEGORY_ADOPTION_MANAGE, assertCategoryPreparationPermission } from "./category-adoption-access";

interface PreparationEnvelope {
  formatVersion?: 2;
  sourceVersionId?: string;
  operation?: "upgrade" | "restore";
  reason?: string;
  items?: CategoryEntityPreparationPatch[];
  capabilityPatches?: CategoryCapabilityPreparationPatch[];
}

@Injectable()
export class CategoryAdoptionPreparationService {
  constructor(private readonly prisma: PrismaService, private readonly capabilities: WorkspaceCapabilityService, private readonly hooks: CapabilityHookRuntime, private readonly subscriptions: SubscriptionService,
    @Optional() private readonly auth?: AuthService, @Optional() private readonly adoptions?: CategoryAdoptionApplication) {}

  /** Owns the preparation/read transaction; recheck expiry and Rental scope as
   * the final step, including receipt replay. No automatic transaction retry. */
  private transaction<T>(user: SystemUserRow, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      const access = await lockCategoryAdoptionAccess(tx, user, this.auth);
      const result = await run(tx);
      await access.revalidate();
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("权限或经营资料发生并发冲突，本事务未完成；请核对原批次收据及当前准备，保留原操作键");
      }
      throw error;
    });
  }
  async candidates(user: SystemUserRow, operation: string) {
    assertCategoryPreparationPermission(user);
    if (operation !== "upgrade" && operation !== "restore") throw new BadRequestException("版本操作只能是升级或恢复");
    const workspaceId = requireRequestWorkspaceId();
    return this.transaction(user, async tx => {
      const workspace = await tx.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId: user.tenantId, status: "ACTIVE" }, select: { categoryCode: true, categoryVersionId: true, categoryAdoptionRevision: true } });
      if (!workspace?.categoryVersionId) throw new ConflictException("经营空间不可用或尚未绑定版本");
      const versions = await tx.rentalCategoryVersion.findMany({ where: { categoryCode: workspace.categoryCode, status: { in: ["published", "legacy_baseline"] }, id: { not: workspace.categoryVersionId } }, include: { policy: true }, orderBy: [{ publishedAt: "desc" }, { id: "asc" }] });
      // Opening policy governs NEW spaces, not existing-space upgrades/restores.
      // Never return definitions, pilot tenant lists, drafts or governance audits.
      return { categoryCode: workspace.categoryCode.toLowerCase(), sourceVersionId: workspace.categoryVersionId, sourceRevision: workspace.categoryAdoptionRevision, operation,
        versions: versions.filter((row) => row.policy && categoryScopeAllows(row.policy[`${operation}Scope`], row.policy[`${operation}TenantIds`], user.tenantId)).map((row) => {
          try {
            resolveRentalCategoryVersionBody(row, workspace.categoryCode.toLowerCase());
            return { id: row.id, versionLabel: row.versionLabel, definitionExecutable: true };
          } catch (error) {
            return { id: row.id, versionLabel: row.versionLabel, definitionExecutable: false, unavailableReason: error instanceof Error ? error.message : "目标版本无法执行，请联系平台管理员" };
          }
        }) };
    });
  }
  private async authorizedWorkspace(tx: Prisma.TransactionClient, user: SystemUserRow, targetId: string, operation: string) {
    if (typeof targetId !== "string" || !targetId.trim() || targetId.length > 191) throw new BadRequestException("目标品类版本标识无效");
    if (!["upgrade", "restore"].includes(operation)) throw new BadRequestException("版本操作只能是升级或恢复");
    const workspaceId = requireRequestWorkspaceId();
    const identity = await tx.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId: user.tenantId }, select: { categoryCode: true } });
    if (!identity) throw new NotFoundException("经营空间不存在");
    // Same lock order as governance and final adoption: identity/policy, then space.
    const policy = await assertCategoryAdoptionAllowed(tx, user.tenantId, identity.categoryCode, targetId, operation as "upgrade" | "restore");
    await tx.$queryRaw(Prisma.sql`SELECT id FROM business_workspaces WHERE tenantId = ${user.tenantId} AND id = ${workspaceId} FOR UPDATE`);
    const workspace = await tx.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId: user.tenantId, status: "ACTIVE" } });
    if (!workspace?.categoryVersionId) throw new ConflictException("经营空间不可用或尚未绑定版本");
    if (workspace.categoryCode !== identity.categoryCode || workspace.categoryVersionId === targetId) throw new ConflictException("目标版本已采用或品类身份已变化");
    return { workspace: { ...workspace, categoryVersionId: workspace.categoryVersionId }, workspaceId, targetPolicyRevision: policy.versionPolicyRevision };
  }
  private async context(tx: Prisma.TransactionClient, user: SystemUserRow, targetId: string, operation: string) {
    const { workspace, workspaceId, targetPolicyRevision } = await this.authorizedWorkspace(tx, user, targetId, operation);
    const [target, source, groups, assets, preparation, capabilityRows] = await Promise.all([
      tx.rentalCategoryVersion.findUnique({ where: { id: targetId } }),
      tx.rentalCategoryVersion.findUnique({ where: { id: workspace.categoryVersionId } }),
      tx.rentalItemGroup.findMany({ where: { tenantId: user.tenantId, workspaceId }, include: { bundleComponents: { select: { componentItemGroupId: true, quantity: true, optional: true, substitutionGroup: true } } }, orderBy: { id: "asc" } }),
      tx.rentalAsset.findMany({ where: { tenantId: user.tenantId, workspaceId }, orderBy: { id: "asc" } }),
      tx.rentalCategoryAdoptionPreparation.findUnique({ where: { workspaceId_targetVersionId: { workspaceId, targetVersionId: targetId } } }),
      tx.workspaceCapabilityInstance.findMany({ where: { tenantId: user.tenantId, workspaceId }, select: { code: true, status: true, revision: true, implementationVersion: true, configVersion: true, config: true } })
    ]);
    const code = workspace.categoryCode.toLowerCase();
    const definition = resolveRentalCategoryVersionBody(target, code);
    const sourceDefinition = resolveRentalCategoryVersionBody(source, code);
    const records = { groups: groups.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })), assets: assets.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })) };
    const capabilityInstances = capabilityRows.map((row) => ({ ...row, code: row.code as RentalCapability, status: row.status as RentalCapabilityLifecycleStatus, config: row.config as RentalCapabilityConfig }));
    return { workspace, workspaceId, targetPolicyRevision, target: target!, definition, sourceDefinition, preparation, records, capabilityInstances };
  }
  async preview(user: SystemUserRow, targetId: string, operation: string, metadataOnly = false): Promise<CategoryPreparationPreview> {
    assertCategoryPreparationPermission(user);
    return this.transaction(user, async (tx) => {
      const context = await this.context(tx, user, targetId, operation);
      const now = new Date();
      const envelope = context.preparation?.patches as PreparationEnvelope | undefined;
      const patches = envelope?.operation === operation ? envelope.items ?? [] : [];
      const stale = Boolean(context.preparation && (context.preparation.sourceRevision !== context.workspace.categoryAdoptionRevision || envelope?.sourceVersionId !== context.workspace.categoryVersionId));
      let validation: { valid: boolean; errors: string[] };
      let candidateCapabilityPatches: CategoryCapabilityPreparationPatch[] = [];
      let candidateRecords = context.records;
      try {
        if (stale) throw new ConflictException("当前绑定已变化，预备资料必须重新准备");
        const projected = prepareCategoryAdoptionRecords(context.definition, context.records.groups, context.records.assets, patches, envelope?.formatVersion === 2 ? "collection" : "batch");
        const groups = new Map(projected.itemGroups.map((row) => [row.id, row]));
        const assets = new Map(projected.assets.map((row) => [row.id, row]));
        candidateRecords = {
          groups: context.records.groups.map((row) => ({ ...row, attributes: groups.get(row.id)!.attributes })),
          assets: context.records.assets.map((row) => ({ ...row, attributes: assets.get(row.id)!.attributes, serialNo: assets.get(row.id)!.serialNo ?? null }))
        };
        if (envelope?.operation === operation && envelope.capabilityPatches !== undefined) {
          this.capabilities.prepareAdoptionConfigs(context.definition, context.capabilityInstances, envelope.capabilityPatches, this.hooks.registeredVersions());
          candidateCapabilityPatches = envelope.capabilityPatches;
        }
        validation = { valid: true, errors: [] };
      } catch (error) { validation = { valid: false, errors: [error instanceof Error ? error.message : "预备资料校验失败"] }; }
      const adoptionImplemented = this.adoptions?.enabled() ?? false;
      const compatibility = adoptionImplemented && validation.valid
        ? await readFinalCategoryAdoptionCompatibility(tx, user.tenantId, context.workspaceId, context.definition, candidateRecords,
          { capabilities: this.capabilities, registeredVersions: this.hooks.registeredVersions(), hooks: this.hooks }, now, candidateCapabilityPatches)
        : await readCategoryAdoptionCompatibility(tx, user.tenantId, context.workspaceId, context.definition, candidateRecords, this.capabilities, this.hooks, now, candidateCapabilityPatches);
      const commercialRequirements = categoryCommercialRequirements(context.definition,
        compatibility.checkedCapabilityCodes.map(code => ({ code, status: "enabled" })), undefined, compatibility.requiredCapabilityCodes);
      const commercialContext = await this.subscriptions.readCategoryCommercialContext(user.tenantId, tx, now, commercialRequirements.featureCodes);
      const commercialCompatibility = categoryCommercialCompatibility(context.definition.code, commercialRequirements, commercialContext);
      const businessCompatibility = {
        ...compatibility, valid: compatibility.valid && commercialCompatibility.valid,
        blockers: [...compatibility.blockers, ...commercialCompatibility.blockers],
        scope: `${compatibility.scope}_${commercialCompatibility.scope}`
      };
      return { sourceVersionId: context.workspace.categoryVersionId, sourceRevision: context.workspace.categoryAdoptionRevision,
        targetPolicyRevision: context.targetPolicyRevision,
        targetVersionId: targetId, targetVersionLabel: context.target.versionLabel, targetDefinition: context.definition,
        registeredCapabilityVersions: this.hooks.registeredVersions().filter((key) => [...context.definition.requiredCapabilities,
          ...(context.definition.conditionalCapabilities ?? []).map(row => row.code)].includes(key.split("@")[0] as RentalCapability)),
        differences: categoryDefinitionDifferences(context.sourceDefinition, context.definition),
        preparation: context.preparation ? {
          id: context.preparation.id, revision: context.preparation.revision, sourceRevision: context.preparation.sourceRevision,
          formatVersion: envelope?.formatVersion ?? 1,
          // Receipts are server-owned idempotency evidence, not editable form state.
          patches: { sourceVersionId: envelope?.sourceVersionId, operation: envelope?.operation, reason: envelope?.reason,
            items: metadataOnly ? [] : envelope?.items ?? [], capabilityPatches: envelope?.capabilityPatches ?? [] },
          entityCount: envelope?.items?.length ?? 0
        } : null,
        metadataOnly,
        preparationLimits: CATEGORY_PREPARATION_LIMITS,
        validation, validationScope: "entity_attributes_inventory_uniqueness", businessCompatibility, commercialContext, stale, previewOnly: true, adoptionImplemented,
        entities: { itemGroups: metadataOnly ? [] : context.records.groups.map((row) => ({ id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(), attributes: Object.fromEntries(Object.entries(row.attributes).filter(([key]) => key !== "__itemGroupMedia")) })),
          assets: metadataOnly ? [] : context.records.assets.map((row) => ({ id: row.id, assetNo: row.assetNo, updatedAt: row.updatedAt.toISOString(), serialNo: row.serialNo, attributes: row.attributes })),
          capabilities: context.capabilityInstances ?? [] } };
    });
  }
  async entities(user: SystemUserRow, targetId: string, query: CategoryPreparationEntitiesQuery): Promise<CategoryPreparationEntityPage> {
    assertCategoryPreparationPermission(user);
    if (!query || typeof query !== "object") throw new BadRequestException("预备资料分页参数无效");
    const limit = query.limit ?? 50;
    if (!["item_group", "asset"].includes(query.entityType) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
        (query.entityId !== undefined && (typeof query.entityId !== "string" || !query.entityId.trim() || query.entityId.length > 191)) ||
        (query.after !== undefined && (typeof query.after !== "string" || !query.after.trim() || query.after.length > 191)) ||
        (query.search !== undefined && (typeof query.search !== "string" || query.search.length > 100))) {
      throw new BadRequestException("预备资料分页参数无效");
    }
    return this.transaction(user, async (tx) => {
      const operation = query.operation ?? "upgrade";
      const { workspace, workspaceId } = await this.authorizedWorkspace(tx, user, targetId, operation);
      const target = await tx.rentalCategoryVersion.findUnique({ where: { id: targetId } });
      resolveRentalCategoryVersionBody(target, workspace.categoryCode.toLowerCase());
      const preparation = await tx.rentalCategoryAdoptionPreparation.findUnique({ where: { workspaceId_targetVersionId: { workspaceId, targetVersionId: targetId } } });
      const envelope = preparation?.patches as PreparationEnvelope | undefined;
      const stale = Boolean(preparation && (preparation.sourceRevision !== workspace.categoryAdoptionRevision || envelope?.sourceVersionId !== workspace.categoryVersionId));
      const prepared = new Map((envelope?.operation === operation ? envelope.items ?? [] : [])
        .filter((patch) => patch.entityType === query.entityType).map((patch) => [patch.entityId, patch]));
      const scope = { tenantId: user.tenantId, workspaceId };
      const search = query.search?.trim();
      const cursor = query.entityId ? { id: query.entityId } : query.after ? { id: { gt: query.after } } : {};
      let total: number;
      let values: Array<{ id: string; updatedAt: Date; attributes: unknown; name?: string; assetNo?: string; serialNo?: string | null }>;
      if (query.entityType === "item_group") {
        const where = { ...scope, ...(query.entityId ? { id: query.entityId } : {}), ...(search ? { OR: [{ name: { contains: search } }, { code: { contains: search } }] } : {}) };
        [values, total] = await Promise.all([
          tx.rentalItemGroup.findMany({ where: { ...where, ...cursor }, orderBy: { id: "asc" }, take: limit + 1, select: { id: true, name: true, updatedAt: true, attributes: true } }),
          tx.rentalItemGroup.count({ where })
        ]);
      } else {
        const where = { ...scope, ...(query.entityId ? { id: query.entityId } : {}), ...(search ? { OR: [{ assetNo: { contains: search } }, { serialNo: { contains: search } }] } : {}) };
        [values, total] = await Promise.all([
          tx.rentalAsset.findMany({ where: { ...where, ...cursor }, orderBy: { id: "asc" }, take: limit + 1, select: { id: true, assetNo: true, serialNo: true, updatedAt: true, attributes: true } }),
          tx.rentalAsset.count({ where })
        ]);
      }
      const rows = values.slice(0, limit).map((row) => {
        const patch = prepared.get(row.id);
        return { ...row, updatedAt: row.updatedAt.toISOString(),
          attributes: Object.fromEntries(Object.entries((row.attributes ?? {}) as Record<string, unknown>).filter(([key]) => key !== "__itemGroupMedia")),
          prepared: patch, preparationStale: stale || Boolean(patch && patch.expectedUpdatedAt !== row.updatedAt.toISOString()) };
      });
      return { entityType: query.entityType, sourceVersionId: workspace.categoryVersionId, sourceRevision: workspace.categoryAdoptionRevision,
        preparationRevision: preparation?.revision ?? 0, total, rows, nextCursor: values.length > limit ? rows.at(-1)?.id : undefined };
    });
  }
  async save(user: SystemUserRow, targetId: string, body: SaveCategoryPreparationRequest) {
    assertCategoryPreparationPermission(user);
    if (!body.reason?.trim() || body.reason.length > 512) throw new BadRequestException("必须填写准备原因（最多512字）");
    return this.transaction(user, async (tx) => {
      const context = await this.context(tx, user, targetId, body.operation);
      if (context.workspace.categoryVersionId !== body.expectedSourceVersionId || context.workspace.categoryAdoptionRevision !== body.expectedSourceRevision) throw new ConflictException("来源品类版本已变化，请刷新后重新准备");
      if ((context.preparation?.revision ?? 0) !== body.expectedPreparationRevision) throw new ConflictException("预备资料修订已变化，输入未应用到活动资料");
      if ((context.preparation?.patches as PreparationEnvelope | undefined)?.formatVersion === 2) {
        throw new ConflictException("该准备集合已使用分批保存；旧版整份保存不能覆盖其他批次，请使用支持分批的客户端");
      }
      prepareCategoryAdoptionRecords(context.definition, context.records.groups, context.records.assets, body.patches);
      const prior = context.preparation?.patches as { sourceVersionId?: string; operation?: string; capabilityPatches?: CategoryCapabilityPreparationPatch[] } | undefined;
      const retained = prior?.sourceVersionId === body.expectedSourceVersionId && prior.operation === body.operation && context.preparation?.sourceRevision === body.expectedSourceRevision ? prior.capabilityPatches : undefined;
      // Old entity-only clients must not silently erase separately prepared config.
      // An explicit [] discards config; omission retains it only for the same source/operation.
      const capabilityPatches = body.capabilityPatches !== undefined ? body.capabilityPatches : retained === undefined ? [] : retained;
      const preparedCapabilities = this.capabilities.prepareAdoptionConfigs(context.definition, context.capabilityInstances, capabilityPatches, this.hooks.registeredVersions());
      // Normalize through the actual implementation schema, not arbitrary JSON merging.
      const normalizedPatches = capabilityPatches.map((patch) => ({ ...patch, config: preparedCapabilities.find((row) => row.code === patch.code)!.config }));
      if (Buffer.byteLength(JSON.stringify(normalizedPatches)) > 256 * 1024) throw new BadRequestException("能力预备配置超过256KB");
      const data = { sourceRevision: body.expectedSourceRevision, patches: JSON.parse(JSON.stringify({ sourceVersionId: body.expectedSourceVersionId, operation: body.operation, reason: body.reason.trim(), items: body.patches, capabilityPatches: normalizedPatches })) as Prisma.InputJsonValue };
      const saved = context.preparation ? await tx.rentalCategoryAdoptionPreparation.update({ where: { id: context.preparation.id }, data: { ...data, revision: { increment: 1 } } })
        : await tx.rentalCategoryAdoptionPreparation.create({ data: { ...data, id: randomUUID(), tenantId: user.tenantId, workspaceId: context.workspaceId, targetVersionId: targetId, revision: 1, createdBy: user.id } });
      return { id: saved.id, revision: saved.revision, sourceRevision: saved.sourceRevision, targetVersionId: targetId, preparedOnly: true, adoptionImplemented: false };
    });
  }

  async readBatch(user: SystemUserRow, targetId: string, batchId: string): Promise<CategoryPreparationBatchReadResult> {
    assertCategoryPreparationPermission(user);
    if (typeof targetId !== "string" || !targetId.trim() || targetId.length > 191 ||
        typeof batchId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(batchId)) throw new BadRequestException("目标版本或批次标识无效");
    const workspaceId = requireRequestWorkspaceId();
    // Historical own receipts need current scope/permission, not renewed target
    // adoption eligibility. Missing evidence is unknown, never proof of rollback.
    return this.transaction(user, async tx => {
      const receipt = await tx.rentalCategoryPreparationBatch.findFirst({ where: {
        tenantId: user.tenantId, workspaceId, actorId: user.id, batchId,
        preparation: { targetVersionId: targetId }
      }, select: { result: true, preparationId: true, actorId: true, inputFingerprint: true } });
      return receipt ? { outcome: "saved", result: this.originalBatchResult(receipt, user, targetId, batchId) } : { outcome: "unknown" };
    });
  }

  private originalBatchResult(
    row: { actorId: string; preparationId: string; inputFingerprint: string; result: unknown },
    user: SystemUserRow, targetId: string, batchId: string, fingerprint?: string,
    request?: Pick<SaveCategoryPreparationBatchRequest, "expectedPreparationRevision" | "expectedSourceRevision">
  ) {
    if (row.actorId !== user.id) throw new ConflictException("同一批次标识已用于不同操作人或内容，请读取原保存结果");
    if (typeof row.inputFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(row.inputFingerprint)) {
      throw new ServiceUnavailableException("原批次输入指纹缺失或不可读取，请保留原标识核对");
    }
    if (fingerprint && row.inputFingerprint !== fingerprint) throw new ConflictException("同一批次标识已用于不同操作人或内容，请读取原保存结果");
    const result = readCategoryPreparationBatchResult(row.result, { preparationId: row.preparationId, targetVersionId: targetId, batchId });
    if (request && (result.revision !== request.expectedPreparationRevision + 1 || result.sourceRevision !== request.expectedSourceRevision)) {
      throw new ServiceUnavailableException("原批次回执与原输入修订不一致，请保留原标识核对");
    }
    return result;
  }

  /** Every batch shares the policy -> workspace lock order with adoption. A
   * receipt and the new staged collection commit together; replay never merges
   * a second time, and incomplete staged data never touches current entities. */
  async saveBatch(user: SystemUserRow, targetId: string, body: SaveCategoryPreparationBatchRequest): Promise<CategoryPreparationSaveResult> {
    assertCategoryPreparationPermission(user);
    if (typeof targetId !== "string" || !targetId.trim() || targetId.length > 191) throw new BadRequestException("目标版本标识无效");
    if (!body || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 512 ||
        typeof body.batchId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(body.batchId) ||
        typeof body.expectedSourceVersionId !== "string" || !body.expectedSourceVersionId.trim() || body.expectedSourceVersionId.length > 191 ||
        !Number.isSafeInteger(body.expectedSourceRevision) || body.expectedSourceRevision < 0 ||
        !Number.isSafeInteger(body.expectedPreparationRevision) || body.expectedPreparationRevision < 0 || body.expectedPreparationRevision >= 2147483647 ||
        (body.resetPreparation !== undefined && typeof body.resetPreparation !== "boolean")) {
      throw new BadRequestException("批次标识、准备原因或期望修订无效");
    }
    assertCategoryPreparationBatchSize(body.patches, body.removals ?? []);
    const removeCapabilities = body.removeCapabilityCodes ?? [];
    if (!Array.isArray(removeCapabilities) || removeCapabilities.length > 100 || new Set(removeCapabilities).size !== removeCapabilities.length ||
        removeCapabilities.some((code) => !RENTAL_CAPABILITY_CODES.includes(code)) ||
        (body.capabilityPatches !== undefined && (!Array.isArray(body.capabilityPatches) || body.capabilityPatches.length > 100)) ||
        Buffer.byteLength(JSON.stringify(body)) > CATEGORY_PREPARATION_LIMITS.batchBytes * 2 + 4096) {
      throw new BadRequestException("能力批次或请求大小超过受支持范围");
    }
    const fingerprint = categoryPreparationBatchFingerprint(body);
    return this.transaction(user, async (tx) => {
      // A write-endpoint retry retains its original current eligibility/source
      // checks. Historical receipts are read separately through readBatch.
      const context = await this.context(tx, user, targetId, body.operation);
      if (context.workspace.categoryVersionId !== body.expectedSourceVersionId || context.workspace.categoryAdoptionRevision !== body.expectedSourceRevision) {
        throw new ConflictException("来源品类绑定已变化，请核对原准备及当前版本");
      }
      const prior = context.preparation?.patches as PreparationEnvelope | undefined;
      if (prior?.formatVersion !== undefined && prior.formatVersion !== 2) throw new ConflictException("准备集合结构不受当前程序支持");
      const replay = context.preparation ? await tx.rentalCategoryPreparationBatch.findFirst({ where: {
        tenantId: user.tenantId, workspaceId: context.workspaceId, preparationId: context.preparation.id, batchId: body.batchId
      } }) : null;
      if (replay) {
        return { ...this.originalBatchResult(replay, user, targetId, body.batchId, fingerprint, body), replayed: true };
      }
      if ((context.preparation?.revision ?? 0) !== body.expectedPreparationRevision) throw new ConflictException("准备集合已变化，本批未覆盖其他人的输入");
      const sameSource = prior?.sourceVersionId === body.expectedSourceVersionId && prior.operation === body.operation && context.preparation?.sourceRevision === body.expectedSourceRevision;
      if (context.preparation && !sameSource && !body.resetPreparation) throw new ConflictException("已有准备属于其他来源或操作，须明确重建准备集合，不能自动丢弃");
      const existingItems = sameSource && !body.resetPreparation ? prior?.items ?? [] : [];
      const items = mergeCategoryPreparationBatch(context.definition, context.records, existingItems, body.patches, body.removals);
      const existingCapabilities = sameSource && !body.resetPreparation ? prior?.capabilityPatches ?? [] : [];
      if (!Array.isArray(existingCapabilities)) throw new ConflictException("已有能力准备结构异常");
      const capabilityByCode = new Map(existingCapabilities.map((patch) => [patch.code, structuredClone(patch)]));
      for (const code of removeCapabilities) capabilityByCode.delete(code);
      const changedCodes = new Set<RentalCapability>();
      for (const patch of body.capabilityPatches ?? []) {
        if (!patch || !RENTAL_CAPABILITY_CODES.includes(patch.code) || changedCodes.has(patch.code) || removeCapabilities.includes(patch.code)) {
          throw new BadRequestException("同批能力准备引用无效、重复或同时被撤回");
        }
        changedCodes.add(patch.code); capabilityByCode.set(patch.code, structuredClone(patch));
      }
      const capabilityPatches = [...capabilityByCode.values()];
      const preparedCapabilities = this.capabilities.prepareAdoptionConfigs(context.definition, context.capabilityInstances, capabilityPatches, this.hooks.registeredVersions());
      const normalizedCapabilities = capabilityPatches.map((patch) => ({ ...patch, config: preparedCapabilities.find((row) => row.code === patch.code)!.config }));
      if (Buffer.byteLength(JSON.stringify(normalizedCapabilities)) > CATEGORY_PREPARATION_LIMITS.batchBytes) throw new BadRequestException("累计能力准备超过256KB，本批未保存");
      const id = context.preparation?.id ?? randomUUID();
      const result: CategoryPreparationSaveResult = {
        id, revision: body.expectedPreparationRevision + 1, sourceRevision: body.expectedSourceRevision,
        targetVersionId: targetId, preparedOnly: true, adoptionImplemented: false,
        batchId: body.batchId, entityCount: items.length, replayed: false
      };
      const envelope: PreparationEnvelope = {
        formatVersion: 2, sourceVersionId: body.expectedSourceVersionId, operation: body.operation, reason: body.reason.trim(),
        items, capabilityPatches: normalizedCapabilities
      };
      const data = { sourceRevision: body.expectedSourceRevision, patches: JSON.parse(JSON.stringify(envelope)) as Prisma.InputJsonValue };
      if (context.preparation) {
        const changed = await tx.rentalCategoryAdoptionPreparation.updateMany({ where: { id, tenantId: user.tenantId, workspaceId: context.workspaceId, revision: body.expectedPreparationRevision }, data: { ...data, revision: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictException("准备集合发生并发变化，本批未保存");
      } else {
        await tx.rentalCategoryAdoptionPreparation.create({ data: { ...data, id, tenantId: user.tenantId, workspaceId: context.workspaceId, targetVersionId: targetId, revision: 1, createdBy: user.id } });
      }
      await tx.rentalCategoryPreparationBatch.create({ data: {
        tenantId: user.tenantId, workspaceId: context.workspaceId, preparationId: id,
        batchId: body.batchId, actorId: user.id, inputFingerprint: fingerprint,
        result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue
      } });
      return result;
    });
  }
}

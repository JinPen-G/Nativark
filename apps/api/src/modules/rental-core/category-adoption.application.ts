/** Rental adoption transaction owner and original receipts. Uses original Auth,
 * scoped idempotency storage and Core validation; no initialization, automatic
 * retry, history rewrite or production enablement. */
import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AdoptRentalCategoryRequest, CategoryAdoptionReceipt, CategoryAdoptionResult, SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { AuthService } from "../auth/auth.service";
import { SubscriptionService } from "../subscription/subscription.service";
import { requireRequestWorkspaceId } from "../../common/request-identity";
import { assertCategoryPreparationPermission, lockCategoryAdoptionAccess } from "./category-adoption-access";
import { RentalIdempotencyRepository, requestFingerprint, type RentalIdempotencyStore } from "./rental-idempotency.repository";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { writePreparedCategoryAdoptionPhase } from "./category-adoption-transaction-phase";
import { readRentalCategoryCode } from "./category-identity";

const action = "category.adoption";
const keys = ["expectedSourceVersionId", "expectedSourceRevision", "expectedPreparationRevision", "expectedTargetPolicyRevision", "operation", "idempotencyKey", "reason"];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function validateInput(value: unknown): asserts value is AdoptRentalCategoryRequest {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) ||
      typeof value.expectedSourceVersionId !== "string" || !value.expectedSourceVersionId.trim() || value.expectedSourceVersionId.length > 191 ||
      typeof value.operation !== "string" || !["upgrade", "restore"].includes(value.operation) ||
      typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}(?![\s\S])/u.test(value.idempotencyKey) ||
      typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 512 ||
      ["expectedSourceRevision", "expectedPreparationRevision", "expectedTargetPolicyRevision"].some(key => !Number.isSafeInteger(value[key]) || Number(value[key]) < (key === "expectedPreparationRevision" ? 1 : 0) || Number(value[key]) >= 2147483647)) {
    throw new BadRequestException("采用请求的来源、准备/政策修订、原操作键或原因无效");
  }
}

@Injectable()
export class CategoryAdoptionApplication {
  constructor(private readonly prisma: PrismaService,
    @Inject(RentalIdempotencyRepository) private readonly receipts: RentalIdempotencyStore,
    private readonly auth: AuthService, private readonly capabilities: WorkspaceCapabilityService,
    private readonly hooks: CapabilityHookRuntime, private readonly subscriptions: SubscriptionService) {}

  enabled() {
    return process.env.NODE_ENV !== "production" && process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW === "true" &&
      process.env.RENTAL_CATEGORY_ADOPTION === "true";
  }

  async adopt(user: SystemUserRow, targetId: string, body: AdoptRentalCategoryRequest): Promise<CategoryAdoptionResult> {
    assertCategoryPreparationPermission(user);
    if (!this.enabled()) throw new NotFoundException("正式采用测试入口尚未开放");
    if (typeof targetId !== "string" || !targetId.trim() || targetId.length > 191) throw new BadRequestException("目标版本标识无效");
    validateInput(body);
    // Capture before awaiting locks: execution, audit and original-key recovery
    // must use the same request even if the caller later edits its object.
    body = structuredClone(body);
    const input = { targetVersionId: targetId, ...body };
    const workspaceId = requireRequestWorkspaceId();
    const fingerprint = requestFingerprint({ actorId: user.id, workspaceId, input });
    try {
      return await this.prisma.$transaction(async tx => {
        const access = await lockCategoryAdoptionAccess(tx, user, this.auth);
        const original = await this.receipts.find(user.tenantId, action, body.idempotencyKey, tx);
        if (original) {
          const result = await this.verifyReceipt(tx, user, workspaceId, body.idempotencyKey, original, fingerprint);
          if (!result) throw new ConflictException("原采用键不属于当前操作人，禁止重复执行");
          await access.revalidate();
          return result;
        }
        const written = await writePreparedCategoryAdoptionPhase(tx, { tenantId: user.tenantId, workspaceId, actorId: user.id,
          targetVersionId: targetId, operation: body.operation,
          expected: { categoryVersionId: body.expectedSourceVersionId, adoptionRevision: body.expectedSourceRevision },
          expectedPreparationRevision: body.expectedPreparationRevision, expectedTargetPolicyRevision: body.expectedTargetPolicyRevision,
          reason: body.reason.trim() }, { capabilities: this.capabilities, registeredVersions: this.hooks.registeredVersions(), hooks: this.hooks }, this.subscriptions, this.auth);
        const result: CategoryAdoptionResult = { outcome: "adopted", operation: body.operation, categoryCode: written.categoryCode,
          sourceVersionId: body.expectedSourceVersionId, sourceRevision: body.expectedSourceRevision,
          targetVersionId: targetId, adoptionRevision: written.adoptionRevision,
          preparationRevision: body.expectedPreparationRevision, targetPolicyRevision: written.targetPolicyRevision,
          auditId: written.auditId, adoptedAt: written.adoptedAt };
        await this.receipts.record({ tenantId: user.tenantId, action, key: body.idempotencyKey, requestHash: fingerprint, orderId: null,
          response: { version: 1, actorId: user.id, workspaceId, inputFingerprint: fingerprint, input, result } }, tx);
        // Receipt, audit and binding commit together. Expiry after the phase but
        // before recording still causes rollback of this whole transaction.
        await access.revalidate();
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 30000 });
    } catch (error) {
      const conflict = error instanceof ConflictException || error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);
      if (conflict) {
        // Only read a winner's original result; never rerun the mutation.
        const recovered = await this.readOriginal(user, body.idempotencyKey, fingerprint);
        if (recovered.outcome === "adopted") return recovered.result;
        if (error instanceof Prisma.PrismaClientKnownRequestError) throw new ConflictException("采用发生并发冲突，请保留原操作键核对原收据和当前准备");
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("采用结果尚待核对，请保留原输入和原操作键，读取原采用收据后处理");
    }
  }

  /** Current original actor access; later policy/binding changes do not erase the
   * old audit. Absence stays unknown and never authorizes another write. */
  async readOriginal(user: SystemUserRow, key: string, expectedFingerprint?: string): Promise<CategoryAdoptionReceipt> {
    assertCategoryPreparationPermission(user);
    if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}(?![\s\S])/u.test(key)) throw new BadRequestException("原采用键无效");
    const workspaceId = requireRequestWorkspaceId();
    return this.prisma.$transaction(async tx => {
      const access = await lockCategoryAdoptionAccess(tx, user, this.auth);
      const original = await this.receipts.find(user.tenantId, action, key, tx);
      const result = original ? await this.verifyReceipt(tx, user, workspaceId, key, original, expectedFingerprint) : undefined;
      await access.revalidate();
      return result ? { outcome: "adopted", result } : { outcome: "unknown" };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async verifyReceipt(tx: Prisma.TransactionClient, user: SystemUserRow, workspaceId: string, key: string,
    original: NonNullable<Awaited<ReturnType<RentalIdempotencyStore["find"]>>>, expectedFingerprint?: string): Promise<CategoryAdoptionResult | undefined> {
    const envelope = original.response;
    if (!object(envelope) || envelope.version !== 1 || envelope.workspaceId !== workspaceId || original.orderId !== null || original.status !== "succeeded") {
      throw new ServiceUnavailableException("原采用收据缺少安全恢复依据，请保留原键核对；禁止重新执行");
    }
    if (envelope.actorId !== user.id) {
      if (expectedFingerprint) throw new ConflictException("同一原采用键已由其他操作人使用，禁止改键重复执行");
      return undefined;
    }
    const input = envelope.input, result = envelope.result;
    if (!object(input) || !object(result) || typeof input.targetVersionId !== "string" || !input.targetVersionId.trim()) {
      throw new ServiceUnavailableException("原采用收据输入或结果不可读取，禁止重新执行");
    }
    const { targetVersionId, ...request } = input;
    try { validateInput(request); } catch { throw new ServiceUnavailableException("原采用收据输入契约不完整，禁止重新执行"); }
    const calculated = requestFingerprint({ actorId: user.id, workspaceId, input });
    if (input.idempotencyKey !== key || original.requestHash !== calculated || envelope.inputFingerprint !== calculated) {
      throw new ServiceUnavailableException("原采用收据指纹不一致，请核对持久化证据；禁止重新执行");
    }
    if (expectedFingerprint && expectedFingerprint !== calculated) throw new ConflictException("同一原采用键的内容已变化，请读取原收据后核对");
    const resultKeys = ["outcome", "operation", "categoryCode", "sourceVersionId", "sourceRevision", "targetVersionId", "adoptionRevision", "preparationRevision", "targetPolicyRevision", "auditId", "adoptedAt"];
    if (Object.keys(result).some(key => !resultKeys.includes(key)) || result.outcome !== "adopted" || result.operation !== request.operation ||
        result.sourceVersionId !== request.expectedSourceVersionId || result.sourceRevision !== request.expectedSourceRevision ||
        result.targetVersionId !== targetVersionId || result.adoptionRevision !== request.expectedSourceRevision + 1 ||
        result.preparationRevision !== request.expectedPreparationRevision || result.targetPolicyRevision !== request.expectedTargetPolicyRevision ||
        typeof result.categoryCode !== "string" || typeof result.auditId !== "string" || typeof result.adoptedAt !== "string") {
      throw new ServiceUnavailableException("原采用收据与原输入不一致，禁止重新执行");
    }
    const target = await tx.rentalCategoryVersion.findUnique({ where: { id: targetVersionId }, select: { categoryCode: true } });
    if (!target || readRentalCategoryCode(target.categoryCode) !== result.categoryCode) throw new ServiceUnavailableException("原采用品类版本与收据不一致，禁止重新执行");
    const audit = await tx.rentalCategoryAdoptionAudit.findFirst({ where: { id: result.auditId, tenantId: user.tenantId, workspaceId,
      actorId: user.id, action: request.operation, fromVersionId: request.expectedSourceVersionId, toVersionId: targetVersionId,
      fromRevision: request.expectedSourceRevision, toRevision: request.expectedSourceRevision + 1, reason: request.reason.trim() } });
    if (!audit || audit.createdAt.toISOString() !== result.adoptedAt) {
      throw new ServiceUnavailableException("原采用审计缺失或与收据不一致，禁止重新执行");
    }
    return structuredClone(result) as unknown as CategoryAdoptionResult;
  }
}

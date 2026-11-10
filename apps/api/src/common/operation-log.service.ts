/** Original OperationLog writes. Legacy Web audit keeps its ALS/best-effort path;
 * OAuth and MCP metadata Native methods use exact scope and fail closed.
 * Logging grants no permission or business/commit outcome; callers own the transaction. */
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { Prisma, AiAudience } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../modules/database/prisma.service";
import { getRequestWorkspaceId } from "./request-identity";
import { isDeepStrictEqual } from 'node:util';
import type { OriginalCatalogGoalIntentAudit } from '@rental-os/mcp-server/prisma-mcp-catalog-goal-intents' with { 'resolution-mode': 'import' };
import { AI_SCENE_CODES } from '@rental-os/shared';
import { requestFingerprint } from '../modules/rental-core/rental-idempotency.repository';

export interface OperationLogInput {
  tenantId?: string;
  user?: SystemUserRow;
  userId?: string;
  /** 租赁订单（rental_orders）。 */
  rentalOrderId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  operator?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
  /** Sensitive-data reads must not return data unless their audit record is durable. */
  requireSuccess?: boolean;
}

/** Server-only original OAuth event association, never an HTTP/MCP input DTO.
 * The original authenticated consent/grant/management author owns these IDs. */
export type OriginalOAuthAuditRecord = {
  tenantId: string; userId: string;
  targetType: "mcp-oauth-consent" | "mcp-oauth-grant" | "mcp-oauth-code" | "mcp-oauth-admission" | "mcp-oauth-public-client" | "mcp-oauth-client-review" | "mcp-oauth-subject-binding" | "mcp-oauth-consent-policy" | "mcp-oauth-consent-review";
  targetId: string; operationKey: string; revision: number; grantId: string | null;
} & (
  { workspaceId: string; action: "mcp.oauth.consent.prepared" | "mcp.oauth.consent.approved" | "mcp.oauth.consent.denied" | "mcp.oauth.grant.created" | "mcp.oauth.grant.revoked" | "mcp.oauth.code.issued" | "mcp.oauth.admission.workspace.saved" | "mcp.oauth.subject.binding.saved" | "mcp.oauth.consent.policy.workspace.saved" | "mcp.oauth.notice.review.workspace.prepared" | "mcp.oauth.notice.review.workspace.approved" | "mcp.oauth.notice.review.workspace.denied" }
  // Original platform events belong to the actor's account tenant, not a space.
  | { workspaceId: null; action: "mcp.oauth.admission.platform.saved" | "mcp.oauth.client.registration.saved" | "mcp.oauth.client.review.prepared" | "mcp.oauth.client.review.approved" | "mcp.oauth.client.review.denied" | "mcp.oauth.consent.policy.platform.saved" | "mcp.oauth.notice.review.platform.prepared" | "mcp.oauth.notice.review.platform.approved" | "mcp.oauth.notice.review.platform.denied" }
);

/** Server-only original catalog frontier transition event; not business success. */
export interface OriginalMcpCatalogGoalAdoptionAuditRecord {
  id: string; ownerKey: string; userId: string; tenantId: string; workspaceId: string;
  oldGoalId: string; newGoalId: string; recordHash: string;
}

/** Server-only MCP original-request save event, not a tool/HTTP input. The
 * original creator/row observer supplies these fields inside the same Native. */
export interface OriginalMcpRequestSaveAuditRecord {
  tenantId: string; workspaceId: string; userId: string; scopeId: string; inputRef: string;
  revision: number; contentHash: string; sceneCode: string; sceneVersion: string;
  policyRevision: number; policyHash: string; grantId: string; grantRevision: number;
}

/** Original catalog goal/publication metadata only, never model/HTTP input. */
export interface OriginalMcpReadGoalAuditRecord {
  kind: 'admitted' | 'bindings_published'; goalId: string; ownerKey: string;
  userId: string; tenantId: string; workspaceId: string; grantId: string; grantRevision: number;
  authorityHash: string; recordHash: string; bindingKeys: readonly string[];
}

export interface HttpMutationAuditInput {
  method: string;
  path: string;
  /** 由调用方或路径解析得出的通用租赁订单 id。 */
  rentalOrderId?: string;
  requestId?: string;
  user?: SystemUserRow;
  body?: unknown;
  status: "success" | "failed";
  durationMs: number;
  errorMessage?: string;
}

@Injectable()
export class OperationLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: OperationLogInput) {
    const tenantId = input.tenantId ?? input.user?.tenantId;

    if (!tenantId) {
      if (input.requireSuccess) throw new InternalServerErrorException("敏感资料审计失败，未返回完整信息");
      return;
    }

    try {
      await this.prisma.operationLog.create({
        data: {
          tenantId,
          // SPACE-03：经营空间归属取自**会话**，不接受调用方传入，也不回退默认空间。
          // 平台域动作（租户创建/冻结、平台配置）本就没有空间，留 NULL 表示"不属于
          // 任何经营空间"——比塞一个看似精确的假归属诚实。
          workspaceId: getRequestWorkspaceId() ?? null,
          userId: input.userId ?? input.user?.id,
          rentalOrderId: input.rentalOrderId,
          action: input.action,
          detail: this.toJsonValue({
            operator:
              input.operator ??
              input.user?.displayName ??
              input.user?.account ??
              "系统",
            targetType: input.targetType,
            targetId: input.targetId,
            detail: input.detail,
            metadata: this.maskSensitive(input.metadata ?? {})
          })
        }
      });
    } catch {
      if (input.requireSuccess) throw new InternalServerErrorException("敏感资料审计失败，未返回完整信息");
      // 审计不能阻断业务主流程；MySQL 未连接时由业务自身错误处理。
    }
  }

  /** Atomic ORIGINAL OAuth audit, not the interceptor's eventual/best-effort log.
   * Supplied native transaction is mandatory; do not read mutable Web ALS, borrow
   * global Prisma or swallow errors. Original author commits the event/action
   * together and owns unknown reconciliation; this method never retries/commits. */
  async recordOriginalOAuthAudit(transaction: Prisma.TransactionClient, input: OriginalOAuthAuditRecord, signal: AbortSignal): Promise<void> {
    const fail = () => new InternalServerErrorException('原OAuth事务审计不可用');
    try {
      if (signal.aborted || !transaction?.operationLog || typeof transaction.operationLog.create !== 'function'
        || !input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw fail();
      const keys = ['tenantId', 'userId', 'workspaceId', 'action', 'targetType', 'targetId', 'operationKey', 'revision', 'grantId'];
      const descriptors = Object.getOwnPropertyDescriptors(input), value: Record<string, unknown> = {};
      if (Reflect.ownKeys(descriptors).length !== keys.length) throw fail();
      for (const key of keys) { const field = descriptors[key]; if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw fail(); value[key] = field.value; }
      const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
      const ref = (v: unknown) => typeof v === 'string' && /^[\x21-\x7e]{1,200}$/.test(v);
      const consent = ['mcp.oauth.consent.prepared', 'mcp.oauth.consent.approved', 'mcp.oauth.consent.denied'].includes(value.action as string);
      const grant = value.action === 'mcp.oauth.grant.created' || value.action === 'mcp.oauth.grant.revoked', code = value.action === 'mcp.oauth.code.issued';
      const workspace = value.action === 'mcp.oauth.admission.workspace.saved', platform = value.action === 'mcp.oauth.admission.platform.saved';
      const client = value.action === 'mcp.oauth.client.registration.saved';
      const policyPlatform = value.action === 'mcp.oauth.consent.policy.platform.saved', policyWorkspace = value.action === 'mcp.oauth.consent.policy.workspace.saved';
      const noticePlatform = ['mcp.oauth.notice.review.platform.prepared', 'mcp.oauth.notice.review.platform.approved', 'mcp.oauth.notice.review.platform.denied'].includes(value.action as string);
      const noticeWorkspace = ['mcp.oauth.notice.review.workspace.prepared', 'mcp.oauth.notice.review.workspace.approved', 'mcp.oauth.notice.review.workspace.denied'].includes(value.action as string);
      const notice = noticePlatform || noticeWorkspace;
      const review = ['mcp.oauth.client.review.prepared', 'mcp.oauth.client.review.approved', 'mcp.oauth.client.review.denied'].includes(value.action as string), platformScope = platform || client || review || policyPlatform || noticePlatform;
      const subject = value.action === 'mcp.oauth.subject.binding.saved';
      const targetType = consent ? 'mcp-oauth-consent' : notice ? 'mcp-oauth-consent-review' : policyPlatform || policyWorkspace ? 'mcp-oauth-consent-policy' : subject ? 'mcp-oauth-subject-binding' : review ? 'mcp-oauth-client-review' : client ? 'mcp-oauth-public-client' : workspace || platform ? 'mcp-oauth-admission' : grant ? 'mcp-oauth-grant' : 'mcp-oauth-code';
      const invalidBinding = consent
        ? value.grantId !== null || value.targetId !== value.operationKey || value.revision !== (value.action === 'mcp.oauth.consent.prepared' ? 1 : 2)
        : workspace || policyWorkspace ? value.grantId !== null || value.targetId !== value.workspaceId
          : platform || review || policyPlatform || notice ? value.grantId !== null || value.targetId !== value.operationKey
            : subject ? value.grantId !== null || !id(value.targetId)
              : client ? value.grantId !== null
                : !ref(value.grantId) || value.targetId !== (grant ? value.grantId : value.operationKey);
      if (![value.tenantId, value.userId].every(id) || (platformScope ? value.workspaceId !== null : !id(value.workspaceId)) || !ref(value.targetId) || !ref(value.operationKey)
        || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 2147483647
        || !consent && !grant && !code && !workspace && !platform && !client && !review && !subject && !policyPlatform && !policyWorkspace && !notice || value.targetType !== targetType || invalidBinding) throw fail();
      const receipt = await transaction.operationLog.create({
        data: { tenantId: value.tenantId as string, userId: value.userId as string, workspaceId: value.workspaceId as string | null, action: value.action as string,
          detail: { operator: value.userId as string, targetType: value.targetType as string, targetId: value.targetId as string,
            detail: 'Original OAuth transaction event', metadata: { operationKey: value.operationKey as string, revision: value.revision,
              ...(value.grantId !== null ? { grantId: value.grantId as string } : {}) } } }, select: { id: true },
      });
      const idField = receipt && Object.getOwnPropertyDescriptor(receipt, 'id');
      if (signal.aborted || !idField?.enumerable || !Object.hasOwn(idField, 'value') || !ref(idField.value)) throw fail();
    } catch { throw fail(); }
  }

  /** Original saved-request event, not OAuth issuance, goal/call accounting or
   * commit evidence. Reuses the server-generated original UUID as this one
   * event's stable key; replay checks the same immutable record, never overwrites
   * or regenerates an ID. The caller owns authorization/fences and atomic commit. */
  async recordOriginalMcpRequestSaveAudit(transaction: Prisma.TransactionClient,
    input: OriginalMcpRequestSaveAuditRecord, signal: AbortSignal): Promise<void> {
    const fail = () => new InternalServerErrorException('原MCP请求保存审计不可用');
    try {
      if (signal.aborted || !transaction || '$transaction' in transaction || typeof transaction.aiScope?.findFirst !== 'function'
        || typeof transaction.aiTaskOriginalRequest?.findFirst !== 'function'
        || typeof transaction.operationLog?.findUnique !== 'function' || typeof transaction.operationLog?.create !== 'function'
        || !input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw fail();
      const keys = ['tenantId', 'workspaceId', 'userId', 'scopeId', 'inputRef', 'revision', 'contentHash', 'sceneCode', 'sceneVersion', 'policyRevision', 'policyHash', 'grantId', 'grantRevision'];
      const descriptors = Object.getOwnPropertyDescriptors(input), value: Record<string, unknown> = {};
      if (Reflect.ownKeys(descriptors).length !== keys.length) throw fail();
      for (const key of keys) { const field = descriptors[key]; if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw fail(); value[key] = field.value; }
      const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(v);
      const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
      const uint = (v: unknown, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= max;
      if (![value.tenantId, value.workspaceId, value.userId, value.scopeId].every(id)
        || typeof value.inputRef !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.inputRef)
        || !uint(value.revision, 4294967295) || !uint(value.policyRevision, 4294967295) || !uint(value.grantRevision, 2147483647)
        || !hash(value.contentHash) || !hash(value.policyHash) || typeof value.sceneCode !== 'string'
        || !(AI_SCENE_CODES as readonly string[]).includes(value.sceneCode) || typeof value.sceneVersion !== 'string' || !value.sceneVersion || value.sceneVersion.length > 64
        || typeof value.grantId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value.grantId)) throw fail();
      const scopeRead = transaction.aiScope.findFirst.bind(transaction.aiScope), originalRead = transaction.aiTaskOriginalRequest.findFirst.bind(transaction.aiTaskOriginalRequest);
      const read = transaction.operationLog.findUnique.bind(transaction.operationLog), write = transaction.operationLog.create.bind(transaction.operationLog);
      const scopeWhere = { id: value.scopeId as string, kind: 'WORKSPACE' as const, tenantId: value.tenantId as string, workspaceId: value.workspaceId as string };
      const scope: unknown = await scopeRead({ where: scopeWhere, select: { id: true, kind: true, tenantId: true, workspaceId: true } });
      if (signal.aborted || !scope || typeof scope !== 'object' || Array.isArray(scope)) throw fail();
      const scopeFields = Object.getOwnPropertyDescriptors(scope);
      if (Object.entries(scopeWhere).some(([key, expected]) => { const field = scopeFields[key]; return !field?.enumerable || !Object.hasOwn(field, 'value') || field.value !== expected; })) throw fail();
      const original = await originalRead({ where: { id: value.inputRef, scopeId: value.scopeId, audience: AiAudience.OPERATOR, ownerKind: 'USER', ownerId: value.userId },
        select: { id: true, scopeId: true, audience: true, ownerKind: true, ownerId: true, requestKey: true, revision: true,
          contentHash: true, policyRevision: true, policyHash: true, sceneCode: true, sceneVersion: true, status: true, erasedAt: true } });
      if (signal.aborted || !original || original.id !== value.inputRef || original.scopeId !== value.scopeId || original.audience !== AiAudience.OPERATOR
        || original.ownerKind !== 'USER' || original.ownerId !== value.userId || original.status !== 'STORED' || original.erasedAt
        || original.revision !== value.revision || original.contentHash !== value.contentHash || original.policyRevision !== value.policyRevision
        || original.policyHash !== value.policyHash || original.sceneCode !== value.sceneCode || original.sceneVersion !== value.sceneVersion
        || typeof original.requestKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(original.requestKey)) throw fail();
      const detail = { operator: value.userId as string, targetType: 'ai-task-original-request', targetId: value.inputRef as string,
        detail: 'Original MCP request save event', metadata: { scopeId: value.scopeId as string, revision: value.revision as number,
          contentHash: value.contentHash as string, requestKeyHash: requestFingerprint(original.requestKey), sceneCode: value.sceneCode as string,
          sceneVersion: value.sceneVersion as string, policyRevision: value.policyRevision as number, policyHash: value.policyHash as string,
          grantId: value.grantId as string, grantRevision: value.grantRevision as number } };
      const data = { id: value.inputRef as string, tenantId: value.tenantId as string, workspaceId: value.workspaceId as string,
        userId: value.userId as string, rentalOrderId: null, action: 'mcp.original-request.saved', detail };
      const select = { id: true, tenantId: true, workspaceId: true, userId: true, rentalOrderId: true, action: true, detail: true } as const;
      const matches = (row: unknown) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
        const fields = Object.getOwnPropertyDescriptors(row), projected: Record<string, unknown> = {};
        for (const key of Object.keys(select)) { const field = fields[key]; if (!field?.enumerable || !Object.hasOwn(field, 'value')) return false; projected[key] = field.value; }
        return isDeepStrictEqual(projected, data);
      };
      const existing = await read({ where: { id: data.id }, select });
      if (signal.aborted) throw fail();
      if (existing) { if (!matches(existing)) throw fail(); return; }
      const saved = await write({ data: { ...data, detail: detail as Prisma.InputJsonObject }, select });
      if (signal.aborted || !matches(saved)) throw fail();
      const observed = await read({ where: { id: data.id }, select });
      if (signal.aborted || !matches(observed)) throw fail();
    } catch { throw fail(); } // no best-effort success, retry, replacement ID or commit
  }

  /** Durable ORIGINAL goal/publication event in the writer's Native. Metadata is
   * checked against original rows; no body/token, Web ALS fallback, second ledger,
   * swallowed errors, retry or commit. Stable event IDs reject conflicting history. */
  async recordOriginalMcpReadGoalAudit(native: Prisma.TransactionClient, input: OriginalMcpReadGoalAuditRecord, signal: AbortSignal, requireExisting = false): Promise<void> {
    const fail = () => new InternalServerErrorException('原MCP目标准入审计不可用');
    try {
      if (signal.aborted || typeof requireExisting !== 'boolean' || !native || '$transaction' in native || typeof native.$queryRaw !== 'function'
        || typeof native.operationLog?.findUnique !== 'function' || typeof native.operationLog?.create !== 'function'
        || !input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw fail();
      const keys = ['kind','goalId','ownerKey','userId','tenantId','workspaceId','grantId','grantRevision','authorityHash','recordHash','bindingKeys'];
      const descriptors = Object.getOwnPropertyDescriptors(input), value: Record<string, unknown> = {};
      if (Reflect.ownKeys(descriptors).length !== keys.length) throw fail();
      for (const key of keys) { const p = descriptors[key]; if (!p?.enumerable || !Object.hasOwn(p, 'value')) throw fail(); value[key] = p.value; }
      const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(v);
      const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
      if (!['admitted','bindings_published'].includes(value.kind as string) || typeof value.goalId !== 'string'
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value.goalId) || ![value.userId,value.tenantId,value.workspaceId].every(id)
        || ![value.ownerKey,value.authorityHash,value.recordHash].every(hash) || typeof value.grantId !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value.grantId) || typeof value.grantRevision !== 'number'
        || !Number.isSafeInteger(value.grantRevision) || value.grantRevision < 1 || value.grantRevision > 2147483647) throw fail();
      const raw = value.bindingKeys;
      if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > 32 || Reflect.ownKeys(raw).length !== raw.length + 1) throw fail();
      const bindings: string[] = [];
      for (let i = 0; i < raw.length; i++) { const p = Object.getOwnPropertyDescriptor(raw, String(i)); if (!p?.enumerable || !Object.hasOwn(p, 'value') || !hash(p.value)) throw fail(); bindings.push(p.value); }
      if (new Set(bindings).size !== bindings.length || (value.kind === 'admitted' ? bindings.length !== 0 : bindings.length === 0)) throw fail();
      bindings.sort();
      const rows = await native.$queryRaw<unknown[]>`SELECT ownerKey, goalId, grantId, grantRevision, userId, tenantId, workspaceId, authorityHash, recordHash, recordJson FROM mcp_read_catalog_goals WHERE goalId = ${value.goalId} FOR UPDATE NOWAIT`;
      if (signal.aborted || !Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw fail();
      const row = rows[0] as Record<string, unknown>, fields = Object.getOwnPropertyDescriptors(row);
      for (const key of keys.filter(k => k !== 'kind' && k !== 'bindingKeys')) { const p = fields[key]; if (!p?.enumerable || !Object.hasOwn(p, 'value') || p.value !== value[key]) throw fail(); }
      const json = fields.recordJson;
      if (!json?.enumerable || !Object.hasOwn(json, 'value')) throw fail();
      const body = typeof json.value === 'string' ? JSON.parse(json.value) : json.value;
      if (requestFingerprint(body) !== value.recordHash || body?.target?.goalId !== value.goalId || body?.ownerKey !== value.ownerKey
        || body?.owner?.userId !== value.userId || body?.owner?.tenantId !== value.tenantId || body?.owner?.workspaceId !== value.workspaceId) throw fail();
      for (const key of bindings) {
        const associated = await native.$queryRaw<unknown[]>`SELECT goalId, grantId, grantRevision, userId, tenantId, workspaceId FROM mcp_read_target_bindings WHERE bindingKey = ${key} FOR UPDATE NOWAIT`;
        if (signal.aborted || !Array.isArray(associated) || associated.length !== 1 || !associated[0] || typeof associated[0] !== 'object') throw fail();
        const binding = Object.getOwnPropertyDescriptors(associated[0]);
        for (const k of ['goalId','grantId','grantRevision','userId','tenantId','workspaceId']) {
          const p = binding[k]; if (!p?.enumerable || !Object.hasOwn(p, 'value') || p.value !== value[k]) throw fail();
        }
      }
      const digest = requestFingerprint({ goalId: value.goalId, bindingKeys: bindings });
      const eventId = value.kind === 'admitted' ? value.goalId : `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
      const data = { id: eventId, tenantId: value.tenantId as string, workspaceId: value.workspaceId as string, userId: value.userId as string,
        rentalOrderId: null, action: value.kind === 'admitted' ? 'mcp.read.goal.admitted' : 'mcp.read.goal.bindings.published',
        detail: { operator: value.userId as string, targetType: 'mcp-read-goal', targetId: value.goalId,
          detail: 'Original MCP catalog goal metadata event', metadata: { ownerKey: value.ownerKey, authorityHash: value.authorityHash,
            recordHash: value.recordHash, grantId: value.grantId, grantRevision: value.grantRevision, bindingKeys: bindings } } };
      const select = { id: true, tenantId: true, workspaceId: true, userId: true, rentalOrderId: true, action: true, detail: true } as const;
      const matches = (row: unknown) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
        const d = Object.getOwnPropertyDescriptors(row), found: Record<string, unknown> = {};
        for (const key of Object.keys(select)) { const p = d[key]; if (!p?.enumerable || !Object.hasOwn(p, 'value')) return false; found[key] = p.value; }
        return isDeepStrictEqual(found, data);
      };
      const existing = await native.operationLog.findUnique({ where: { id: eventId }, select });
      if (signal.aborted) throw fail();
      if (existing) { if (!matches(existing)) throw fail(); return; }
      if (requireExisting) throw fail(); // original evidence reads never repair missing audit
      const saved = await native.operationLog.create({ data: { ...data, detail: data.detail as Prisma.InputJsonObject }, select });
      if (signal.aborted || !matches(saved)) throw fail();
      const observed = await native.operationLog.findUnique({ where: { id: eventId }, select });
      if (signal.aborted || !matches(observed)) throw fail();
    } catch { throw fail(); }
  }

  /** Original Web transition-intent event, NOT goal completion/adoption or OAuth
   * consent. Original intent/hash and event share Native; history never repaired. */
  async recordOriginalMcpCatalogGoalIntentAudit(native: Prisma.TransactionClient, input: OriginalCatalogGoalIntentAudit, signal: AbortSignal, requireExisting = false): Promise<void> {
    const fail = () => new InternalServerErrorException('原MCP目标切换意图审计不可用');
    try {
      if (!native || '$transaction' in native || signal.aborted || typeof requireExisting !== 'boolean' || typeof native.$queryRaw !== 'function'
        || typeof native.operationLog?.findUnique !== 'function' || typeof native.operationLog?.create !== 'function' || !input || typeof input !== 'object' || Array.isArray(input)) throw fail();
      const names = ['id','operationKey','userId','tenantId','workspaceId','goalId','recordHash','revision','state'];
      const d = Object.getOwnPropertyDescriptors(input), v: Record<string, unknown> = {};
      if (Reflect.ownKeys(d).length !== names.length) throw fail();
      for (const key of names) { const f = d[key]; if (!f?.enumerable || !Object.hasOwn(f,'value')) throw fail(); v[key] = f.value; }
      const id = (x: unknown) => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(x);
      if (![v.userId,v.tenantId,v.workspaceId].every(id) || typeof v.id !== 'string' || !/^[a-f0-9]{64}$/.test(v.id)
        || typeof v.recordHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.recordHash) || typeof v.goalId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.goalId)
        || typeof v.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.operationKey) || (v.state === 'pending' ? v.revision !== 1 : !['accepted','denied'].includes(v.state as string) || v.revision !== 2)) throw fail();
      const rows = await native.$queryRaw<unknown[]>`SELECT id, operationKey, userId, tenantId, workspaceId, goalId, recordHash, revision, state, recordJson FROM mcp_catalog_goal_intents WHERE id = ${v.id} FOR UPDATE NOWAIT`;
      if (signal.aborted || !Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw fail();
      const f = Object.getOwnPropertyDescriptors(rows[0]);
      for (const key of names) { const field = f[key]; if (!field?.enumerable || !Object.hasOwn(field,'value') || field.value !== v[key]) throw fail(); }
      const json = f.recordJson; if (!json?.enumerable || !Object.hasOwn(json,'value')) throw fail();
      const body = typeof json.value === 'string' ? JSON.parse(json.value) : json.value;
      if (requestFingerprint(body) !== v.recordHash || body?.operationKey !== v.operationKey || body?.owner?.userId !== v.userId || body?.owner?.tenantId !== v.tenantId
        || body?.owner?.workspaceId !== v.workspaceId || body?.goal?.target?.goalId !== v.goalId) throw fail();
      const hash = requestFingerprint({ kind: 'original_catalog_goal_intent_event', id: v.id, revision: v.revision, state: v.state });
      const eventId = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
      const data = { id: eventId, tenantId: v.tenantId as string, workspaceId: v.workspaceId as string, userId: v.userId as string, rentalOrderId: null,
        action: `mcp.read.goal.intent.${v.state === 'pending' ? 'prepared' : v.state}`,
        detail: { operator: v.userId as string, targetType: 'mcp-read-goal-intent', targetId: v.id,
          detail: 'Original Web catalog goal transition intent; not completion or adoption', metadata: { recordHash: v.recordHash, goalId: v.goalId, revision: v.revision } } };
      const select = { id: true, tenantId: true, workspaceId: true, userId: true, rentalOrderId: true, action: true, detail: true } as const;
      const matches = (raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
        const fields = Object.getOwnPropertyDescriptors(raw), actual: Record<string, unknown> = {};
        for (const key of Object.keys(select)) { const field = fields[key]; if (!field?.enumerable || !Object.hasOwn(field,'value')) return false; actual[key] = field.value; }
        return isDeepStrictEqual(actual,data);
      };
      if (v.state !== 'pending') {
        // Accepted/denied history also requires the ORIGINAL preparation event;
        // never reconstruct missing provenance from the current completed row.
        const first = requestFingerprint({ kind: 'original_catalog_goal_intent_event', id: v.id, revision: 1, state: 'pending' });
        const firstId = `${first.slice(0,8)}-${first.slice(8,12)}-${first.slice(12,16)}-${first.slice(16,20)}-${first.slice(20,32)}`;
        const raw = await native.operationLog.findUnique({ where: { id: firstId }, select });
        if (signal.aborted || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail();
        const fields = Object.getOwnPropertyDescriptors(raw), observed: Record<string, unknown> = {};
        for (const key of Object.keys(select)) { const f = fields[key]; if (!f?.enumerable || !Object.hasOwn(f,'value')) throw fail(); observed[key] = f.value; }
        const original = { ...data, id: firstId, action: 'mcp.read.goal.intent.prepared', detail: { ...data.detail, metadata: { ...data.detail.metadata, revision: 1 } } };
        if (!isDeepStrictEqual(observed,original)) throw fail();
      }
      const existing = await native.operationLog.findUnique({ where: { id: eventId }, select }); if (signal.aborted) throw fail();
      if (existing) { if (!matches(existing)) throw fail(); return; }
      if (requireExisting) throw fail();
      const saved = await native.operationLog.create({ data: { ...data, detail: data.detail as Prisma.InputJsonObject }, select });
      if (signal.aborted || !matches(saved) || !matches(await native.operationLog.findUnique({ where: { id: eventId }, select })) || signal.aborted) throw fail();
    } catch { throw fail(); }
  }

  /** Original adoption receipt/event in the caller's Native. Source validates
   * full history and current frontier; this logs their exact original receipt,
   * never token/input/MFA/nonce, refunds, business success or a repaired past. */
  async recordOriginalMcpCatalogGoalAdoptionAudit(native: Prisma.TransactionClient, input: OriginalMcpCatalogGoalAdoptionAuditRecord, signal: AbortSignal, requireExisting = false): Promise<void> {
    const fail = () => new InternalServerErrorException('原MCP目标采用审计不可用');
    try {
      if (!native || '$transaction' in native || signal.aborted || typeof requireExisting !== 'boolean' || typeof native.$queryRaw !== 'function'
        || typeof native.operationLog?.findUnique !== 'function' || typeof native.operationLog?.create !== 'function' || !input || typeof input !== 'object' || Array.isArray(input)) throw fail();
      const names = ['id','ownerKey','userId','tenantId','workspaceId','oldGoalId','newGoalId','recordHash'];
      const d = Object.getOwnPropertyDescriptors(input),v: Record<string,unknown> = {};
      if (Reflect.ownKeys(d).length !== names.length) throw fail();
      for (const key of names) { const f=d[key];if (!f?.enumerable || !Object.hasOwn(f,'value')) throw fail();v[key]=f.value; }
      const id = (x: unknown) => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(x);
      const digest = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
      const uuid = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
      if (![v.userId,v.tenantId,v.workspaceId].every(id) || ![v.id,v.ownerKey,v.recordHash].every(digest) || ![v.oldGoalId,v.newGoalId].every(uuid) || v.oldGoalId === v.newGoalId) throw fail();
      const rows = await native.$queryRaw<unknown[]>`SELECT id, ownerKey, operationKey, userId, tenantId, workspaceId, oldGoalId, newGoalId, intentRecordHash, recordHash, recordJson FROM mcp_catalog_goal_adoptions WHERE id = ${v.id} FOR UPDATE NOWAIT`;
      if (signal.aborted || !Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw fail();
      const fields = Object.getOwnPropertyDescriptors(rows[0]);
      for (const key of names) { const f=fields[key];if (!f?.enumerable || !Object.hasOwn(f,'value') || f.value !== v[key]) throw fail(); }
      const json=fields.recordJson;if (!json?.enumerable || !Object.hasOwn(json,'value')) throw fail();
      const body=typeof json.value === 'string' ? JSON.parse(json.value) : json.value;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail();
      const { recordHash, ...payload }=body;
      if (recordHash !== v.recordHash || requestFingerprint(payload) !== v.recordHash || body.id !== v.id || body.oldGoal?.ownerKey !== v.ownerKey
        || body.oldGoal?.owner?.userId !== v.userId || body.oldGoal?.owner?.tenantId !== v.tenantId || body.oldGoal?.owner?.workspaceId !== v.workspaceId
        || body.oldGoal?.target?.goalId !== v.oldGoalId || body.newGoal?.target?.goalId !== v.newGoalId || body.newGoal?.ownerKey !== v.ownerKey) throw fail();
      const hash=requestFingerprint({ kind:'original_catalog_goal_adoption_event',id:v.id });
      const eventId=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
      const data={ id:eventId,tenantId:v.tenantId as string,workspaceId:v.workspaceId as string,userId:v.userId as string,rentalOrderId:null,action:'mcp.read.goal.adopted',
        detail:{ operator:v.userId as string,targetType:'mcp-read-goal-adoption',targetId:v.id,detail:'Original catalog frontier transition; not business completion',
          metadata:{ ownerKey:v.ownerKey,oldGoalId:v.oldGoalId,newGoalId:v.newGoalId,recordHash:v.recordHash } } };
      const select={ id:true,tenantId:true,workspaceId:true,userId:true,rentalOrderId:true,action:true,detail:true } as const;
      const matches=(raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
        const f=Object.getOwnPropertyDescriptors(raw),value: Record<string,unknown> = {};
        for (const key of Object.keys(select)) { const p=f[key];if (!p?.enumerable || !Object.hasOwn(p,'value')) return false;value[key]=p.value; }return isDeepStrictEqual(value,data);
      };
      const existing=await native.operationLog.findUnique({ where:{ id:eventId },select });if (signal.aborted) throw fail();
      if (existing) { if (!matches(existing)) throw fail();return; }if (requireExisting) throw fail();
      const saved=await native.operationLog.create({ data:{ ...data,detail:data.detail as Prisma.InputJsonObject },select });
      if (signal.aborted || !matches(saved) || !matches(await native.operationLog.findUnique({ where:{ id:eventId },select })) || signal.aborted) throw fail();
    } catch { throw fail(); }
  }

  async recordHttpMutation(input: HttpMutationAuditInput) {
    const normalizedPath = this.normalizePath(input.path);
    const { targetType, targetId } = this.resolveTarget(normalizedPath);

    await this.record({
      user: input.user,
      action: this.resolveAction(input.method, normalizedPath),
      targetType,
      targetId,
      rentalOrderId: input.rentalOrderId ?? this.resolveRentalOrderId(normalizedPath),
      detail:
        input.status === "success"
          ? "接口动作执行成功"
          : `接口动作执行失败：${input.errorMessage ?? "未知错误"}`,
      metadata: {
        requestId: input.requestId,
        method: input.method,
        path: normalizedPath,
        status: input.status,
        durationMs: input.durationMs,
        body: input.body
      }
    });
  }

  private normalizePath(path: string) {
    return path.split("?")[0]?.replace(/^\/api/, "") || "/";
  }

  private resolveAction(method: string, path: string) {
    return `http.${method.toLowerCase()}.${path
      .replace(/^\/+/, "")
      .replace(/\/+/g, ".")
      .replace(/[^a-zA-Z0-9_.:-]/g, "-")}`;
  }

  private resolveTarget(path: string) {
    const parts = path.split("/").filter(Boolean);

    if (parts[0] === "platform") {
      return {
        targetType: parts[1] ?? "platform",
        targetId: parts[2]
      };
    }
    // /rental/v1/<resource>/<id>/... —— 版本段不是资源，必须跳过，
    // 否则 targetType 会变成 "rental"、targetId 变成 "v1"，审计无法按对象检索。
    if (parts[0] === "rental") {
      const resourceIndex = parts[1] && /^v\d+$/u.test(parts[1]) ? 2 : 1;
      const typeMap: Record<string, string> = {
        orders: "rental-order",
        quotes: "rental-quote",
        assets: "rental-asset",
        "item-groups": "rental-item-group",
        locations: "rental-location",
        "coupon-templates": "rental-coupon-template",
        "customer-coupons": "rental-customer-coupon",
        rewards: "rental-reward",
        "rule-versions": "rental-rule-version",
        "pricing-plans": "rental-pricing-plan",
        "notification-templates": "rental-notification-template"
      };
      const resource = parts[resourceIndex] ?? "rental";
      return {
        targetType: typeMap[resource] ?? resource,
        targetId: parts[resourceIndex + 1]
      };
    }
    if (parts[0] === "rental-os") {
      const typeMap: Record<string, string> = {
        orders: "order",
        vehicles: "vehicle",
        stations: "station",
        members: "member",
        corporates: "corporate",
        pricing: "pricing",
        dispatch: "dispatch",
        rules: "rental-rule"
      };
      return {
        targetType: typeMap[parts[1] ?? ""] ?? parts[1] ?? "rental-os",
        targetId: parts[2]
      };
    }

    return {
      targetType: parts[0] ?? "system",
      targetId: parts[1]
    };
  }

  /**
   * 从 /rental/v1/orders/<id>/... 抽出通用租赁订单 id。
   * 只认 orders 资源，避免把其他资源的 id 误填进订单外键而触发约束失败。
   */
  private resolveRentalOrderId(path: string) {
    const match = path.match(/^\/rental\/v\d+\/orders\/([^/]+)/u);
    return match ? match[1] : undefined;
  }

  private toJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private maskSensitive(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.maskSensitive(item));
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
        const shouldMask =
          normalizedKey.includes("password") ||
          normalizedKey.includes("token") ||
          normalizedKey.includes("apikey") ||
          normalizedKey.includes("credential") ||
          normalizedKey.includes("authorization") ||
          normalizedKey.includes("privatekey") ||
          normalizedKey.includes("encryptionkey") ||
          normalizedKey.includes("accesskey") ||
          normalizedKey.includes("baseurl") ||
          normalizedKey.includes("secret") ||
          normalizedKey.includes("phone") ||
          normalizedKey.includes("identity") ||
          normalizedKey.includes("license");

        return [key, shouldMask ? "[masked]" : this.maskSensitive(item)];
      })
    );
  }
}

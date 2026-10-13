import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { AuthService } from '../../auth/auth.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { TenantModelConfigurationAuthority } from '../tenant-model-config.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { aiTaskRunnerLimitsSchema } from './prisma-task-run-evidence.repository';
import { aiPersistedPlanToolsSchema, type PersistedTaskInputTool } from './prisma-task-plan-input.source';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL } from '../model-input/task-model-input';
import { TEXT_CAPABILITY_PROBE_TOOL } from '../text-capability-probe';

const scene = z.object({ code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u),
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u) }).strict();
const revision = z.number().int().min(1).max(4294967293);
const draft = z.object({ expectedRevision: revision.nullable(), enabled: z.boolean(),
  limits: aiTaskRunnerLimitsSchema, expiresAt: z.string().datetime({ offset: true }) }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const identity = ({ requestId: _id, authorizedAt: _at, ...value }: AiExecutionContext) => requestFingerprint(value);
export class AiTaskPlanPolicyResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN' as const;
  readonly retryable = false;
  readonly nextAction = 'reconcile' as const;
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

/** Explicit workspace AI configuration adapter. Uses the existing config Guard,
 * not task ownership as permission to expand execution. Scene is selected by
 * the server composition; callers cannot select scope, tools or a scene.
 * No production registration, policy seed, subscription or dispatch grant. */
export class PrismaTaskPlanPolicyRepository {
  private readonly scopes: AiScopeRepository;
  private readonly management: TenantModelConfigurationAuthority;
  private readonly selected: z.infer<typeof scene>;
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTaskPlanPolicy'>,
    input: { auth: Pick<AuthService, 'resolveAccessContext'>; credentials: AiTaskCredentialSource;
      guard: Pick<ApiAuthGuard, 'canActivate'>; scene: z.infer<typeof scene>; tool?: PersistedTaskInputTool;
      /** Server-owned scene assembly only; put() never accepts tool names. */
      tools?: readonly PersistedTaskInputTool[] },
    private readonly wall: () => Date = () => new Date()) {
    this.selected = scene.parse(structuredClone(input.scene));
    this.tool = input.tool ?? 'rental.catalog.search';
    if (!['rental.catalog.search', 'rental.availability.check', 'rental.order.explain', 'rental.order.commit', 'tenant.notifications.commit', TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, TEXT_CAPABILITY_PROBE_TOOL].includes(this.tool)) throw unavailable();
    const configured = aiPersistedPlanToolsSchema.safeParse((input.tools ?? [this.tool]).map(code => ({ code, version: AI_TOOL_DRAFT_VERSION })));
    if (!configured.success || !configured.data.some(tool => tool.code === this.tool)) throw unavailable();
    this.configuredTools = structuredClone(configured.data);
    if (typeof db?.$transaction !== 'function' || typeof db.aiTaskPlanPolicy?.updateMany !== 'function') throw unavailable();
    const current = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, wall);
    this.scopes = new AiScopeRepository(db, current, wall);
    this.management = new TenantModelConfigurationAuthority(input.guard, input.credentials, current);
  }
  private async access() {
    try {
      const current = await this.scopes.resolveCurrent();
      const c = current.context;
      if (c.scope.kind !== 'workspace' || c.actor.kind !== 'user' || c.audience !== 'operator'
        || current.scope.kind !== 'WORKSPACE') throw denied();
      await this.management.authorize({ tenantId: c.scope.tenantId, workspaceId: c.scope.workspaceId, actorId: c.actor.userId }, 'manage');
      const again = await this.scopes.resolveCurrent();
      if (identity(c) !== identity(again.context) || current.scope.id !== again.scope.id) throw denied();
      return { key: { scopeId: current.scope.id, sceneCode: this.selected.code, sceneVersion: this.selected.version },
        binding: requestFingerprint({ scope: current.scope.id, identity: identity(again.context) }) };
    } catch { throw denied(); }
  }
  private project(row: Prisma.AiTaskPlanPolicyGetPayload<{}>) {
    const limits = aiTaskRunnerLimitsSchema.parse(structuredClone(row.limits));
    if (!Number.isInteger(row.revision) || row.revision < 1 || row.revision > 4294967294
      || row.allowedTools === null || requestFingerprint(row.allowedTools) !== requestFingerprint(this.tools())
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || limits.maxStepMs > limits.maxTotalMs) throw unavailable();
    return { revision: row.revision, enabled: row.enabled, limits, expiresAt: row.expiresAt.toISOString() };
  }
  private readonly tool: PersistedTaskInputTool;
  private readonly configuredTools: z.infer<typeof aiPersistedPlanToolsSchema>;
  private tools() { return structuredClone(this.configuredTools); }
  async read() {
    const before = await this.access();
    const row = await this.db.aiTaskPlanPolicy.findFirst({ where: before.key });
    if ((await this.access()).binding !== before.binding) throw denied();
    if (!row) return { state: 'not_configured' as const };
    if (Object.entries(before.key).some(([key, value]) => row[key as keyof typeof row] !== value)) throw denied();
    return { state: 'configured' as const, ...this.project(row) };
  }
  async put(value: unknown) {
    const parsed = draft.safeParse(structuredClone(value));
    if (!parsed.success || parsed.data.limits.maxStepMs > parsed.data.limits.maxTotalMs
      || Date.parse(parsed.data.expiresAt) <= this.wall().getTime()) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data, before = await this.access();
    let completed = false;
    try {
      return await this.db.$transaction(async tx => {
        // Scope exists even on first create, so absent policy rows still have a
        // stable lock owner. Existing input publication locks policy afterwards.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${before.key.scopeId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT revision FROM ai_task_plan_policies WHERE scopeId = ${before.key.scopeId} AND sceneCode = ${before.key.sceneCode} AND sceneVersion = ${before.key.sceneVersion} FOR UPDATE`);
        if ((await this.access()).binding !== before.binding) throw denied();
        const current = await tx.aiTaskPlanPolicy.findFirst({ where: before.key });
        if (current && Object.entries(before.key).some(([key, value]) => current[key as keyof typeof current] !== value)) throw denied();
        if (command.expectedRevision === null ? current !== null : current?.revision !== command.expectedRevision) throw conflict();
        const next = { enabled: command.enabled, limits: command.limits, allowedTools: this.tools(),
          expiresAt: new Date(command.expiresAt), revision: current ? current.revision + 1 : 1 };
        if (current) {
          const changed = await tx.aiTaskPlanPolicy.updateMany({ where: { ...before.key, revision: command.expectedRevision! }, data: next });
          if (changed.count !== 1) throw conflict();
        } else await tx.aiTaskPlanPolicy.create({ data: { ...before.key, ...next } });
        const saved = await tx.aiTaskPlanPolicy.findFirst({ where: before.key });
        if (!saved) throw unavailable();
        if (Object.entries(before.key).some(([key, value]) => saved[key as keyof typeof saved] !== value)
          || saved.revision !== next.revision || saved.enabled !== next.enabled
          || requestFingerprint(saved.limits) !== requestFingerprint(next.limits)
          || saved.expiresAt.getTime() !== next.expiresAt.getTime()) throw unavailable();
        const result = this.project(saved);
        if ((await this.access()).binding !== before.binding) throw denied();
        if (Date.parse(command.expiresAt) <= this.wall().getTime()) throw denied();
        completed = true;
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (completed) throw new AiTaskPlanPolicyResultUnknownError();
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }
}

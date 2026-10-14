import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import type { RentalWorkspaceReportRepository } from '../../rental-core/rental-workspace-report.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiCatalogReadFactsService, aiCatalogReadInputSchema } from '../catalog-read-facts.service';
import { AiAvailabilityReadFactsService, aiAvailabilityReadInputSchema } from '../availability-read-facts.service';
import { AiOrderReadFactsService } from '../order-read-facts.service';
import { AiMembershipCandidateReadFactsService, aiMembershipCandidateReadInputSchema, type AiMembershipCandidateReadPort } from '../membership-candidate-read-facts.service';
import { AiOpeningReadFactsService, AiRiskReadFactsService, aiOpeningReadInputSchema, aiRiskReadInputSchema } from '../tools/diagnostic-read-facts.service';
import { AiDiagnosticRouteAuthority } from '../tools/diagnostic-route.authority';
import { AiGuardedQuoteCoreContextSource } from '../tools/quote-route.composition';
import { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import { PrismaTaskPlanInputSource, aiPersistedOrderExplainInputSchema, PERSISTED_READONLY_TOOLS, type PersistedReadonlyTool } from './prisma-task-plan-input.source';
import { composeAuthorizedReadonlyPersistentTaskInputRunner } from './authorized-persistent-task-input.composition';
import type { AiTaskRunnerRepositoryCommandFactory } from './ai-task-runner.repository-adapter';
import type { AiTaskRunnerClock } from './ai-task-runner.ports';
import type { AiTaskRegisteredExecutor } from './prisma-task-measured-effects';

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const identity = ({ authorizedAt: _at, requestId: _id, ...context }: AiExecutionContext) => requestFingerprint(context);

/** Closed Core reader compositions, with actual policy/input/registration/result stores.
 * No caller-supplied plan authority, registration grant, command factory or
 * generic executor. The existing Guard establishes ALS for the Core call.
 * No AppModule, HTTP route, worker or enabled/default policy is installed.
 */
type ReadonlyRunnerDependencies = {
  db: PrismaClient;
  authorization: Omit<PersistedTaskAuthorizationDependencies, 'db' | 'clock'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  core: Partial<Pick<RentalCoreService, 'listItemGroups' | 'listItemGroupsPage' | 'availability' | 'getOrder'>>;
  memberships?: AiMembershipCandidateReadPort;
  /** Same current Core configuration producer as the original diagnostic
   * composition, supplied by the server host rather than a task payload. */
  diagnosticCore?: ConstructorParameters<typeof AiGuardedQuoteCoreContextSource>[0];
  business?: Pick<RentalBusinessService, 'tenantReadiness'>;
  reports?: Pick<RentalWorkspaceReportRepository, 'getOperationReport'>;
  wall?: () => Date;
  monotonic?: () => number;
  clock?: AiTaskRunnerClock;
};
export function composePersistedCatalogTaskRunner(input: ReadonlyRunnerDependencies & { core: Pick<RentalCoreService, 'listItemGroups'> }) {
  return composeReadonly(input, 'rental.catalog.search');
}
export function composePersistedAvailabilityTaskRunner(input: ReadonlyRunnerDependencies & { core: Pick<RentalCoreService, 'availability'> }) {
  return composeReadonly(input, 'rental.availability.check');
}
/** Explicit server-selected read step. A model candidate alone neither calls
 * this composition nor publishes its input. Existing scene policy, lease and
 * original order Guard remain mandatory; no finance or write tools are added. */
export function composePersistedOrderFactsTaskRunner(input: ReadonlyRunnerDependencies & { core: Pick<RentalCoreService, 'getOrder'> }) {
  return composeReadonly(input, 'rental.order.explain');
}
/** Current guarded, bounded member candidates only. Publishing an input or
 * completing this read does not choose a customer or establish eligibility. */
export function composePersistedMembershipCandidateTaskRunner(input: ReadonlyRunnerDependencies & { memberships: AiMembershipCandidateReadPort }) {
  return composeReadonly(input, 'membership.customer.resolve');
}
export function composePersistedOpeningTaskRunner(input: ReadonlyRunnerDependencies & {
  diagnosticCore: NonNullable<ReadonlyRunnerDependencies['diagnosticCore']>; business: NonNullable<ReadonlyRunnerDependencies['business']>
}) {
  return composeReadonly(input, 'tenant.opening.diagnose');
}
export function composePersistedRiskTaskRunner(input: ReadonlyRunnerDependencies & {
  diagnosticCore: NonNullable<ReadonlyRunnerDependencies['diagnosticCore']>; reports: NonNullable<ReadonlyRunnerDependencies['reports']>
}) {
  return composeReadonly(input, 'operations.risks.list');
}
/** One immutable server plan and one cumulative resource ledger for a closed
 * group of actual readers. Agent tool names cannot extend this registry. */
export function composePersistedReadonlyBusinessTaskRunner(input: ReadonlyRunnerDependencies & {
  tools: readonly PersistedReadonlyTool[];
}) {
  const tools = [...input.tools];
  if (tools.length < 2 || tools.length > PERSISTED_READONLY_TOOLS.length || new Set(tools).size !== tools.length
    || tools.some(tool => !(PERSISTED_READONLY_TOOLS as readonly string[]).includes(tool))) throw unavailable();
  const readers = tools.map(tool => ({ tool, root: composeReadonly(input, tool) }));
  PrismaTaskPlanInputSource.bindReadonlyPlanSources(readers.map(reader => reader.root.source));
  const selected = (code: string) => readers.find(reader => reader.tool === code)?.root;
  const first = readers[0].root;
  const root = composeAuthorizedReadonlyPersistentTaskInputRunner({ ...input,
    planAuthority: first.source,
    registrationAuthority: { resolve: async command => {
      const access = await first.authorization.tasks.resolveAccess(command.taskId, 'transition_task');
      const task = await input.db.aiTask.findFirst({ where: access.where });
      if (!task) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const row = await input.db.aiTaskActionInput.findFirst({ where: { scopeId: task.scopeId,
        taskId: task.id, runId: command.lease.runId, registrationRef: command.registrationRef } });
      const reader = row && selected(row.toolCode);
      if (!reader) throw unavailable();
      return reader.source.resolve(command);
    } },
    commands: first.commands,
    executors: { resolve: async (code, version) => selected(code)?.executors.resolve(code, version) ?? null },
    inputSource: { resolve: async binding => {
      const reader = selected(binding.toolCode);
      if (!reader) throw unavailable();
      return reader.inputSource.resolve(binding);
    }, validateAnswers: async () => { throw unavailable(); } },
    toolCatalog: { resolve: async (code, version) => selected(code)?.toolCatalog.resolve(code, version) ?? null }
  });
  const reopenBusinessSource = async (value: unknown, signal?: AbortSignal) => {
    const artifact = await root.results.read(value);
    const access = await first.authorization.tasks.resolveAccess(artifact.taskId, 'read_step_terminal');
    const task = await input.db.aiTask.findFirst({ where: access.where });
    if (!task) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const step = await input.db.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: task.id,
      runId: artifact.runId, id: artifact.stepId, resultRef: artifact.resultId } });
    const reader = step && step.toolVersion === AI_TOOL_DRAFT_VERSION && selected(step.toolCode);
    if (!reader) throw unavailable();
    return reader.reopenBusinessSource(value, signal);
  };
  return Object.freeze({ ...root, reopenBusinessSource,
    sources: Object.freeze(Object.fromEntries(readers.map(reader => [reader.tool, reader.root.source]))) });
}
function composeReadonly(input: ReadonlyRunnerDependencies, tool: PersistedReadonlyTool) {
  if (typeof input?.guard?.canActivate !== 'function'
    || (tool === 'membership.customer.resolve'
      ? typeof input?.memberships?.listPersonalOptions !== 'function' || typeof input?.memberships?.listPersonalOptionsPage !== 'function'
      : tool === 'tenant.opening.diagnose' || tool === 'operations.risks.list'
        ? !input?.diagnosticCore || (tool === 'tenant.opening.diagnose'
          ? typeof input?.business?.tenantReadiness : typeof input?.reports?.getOperationReport) !== 'function'
        : (tool === 'rental.catalog.search' ? typeof input?.core?.listItemGroups
        : tool === 'rental.availability.check' ? typeof input?.core?.availability : typeof input?.core?.getOrder) !== 'function')) throw unavailable();
  const authorization = composePersistedTaskAuthorization({ ...input.authorization, db: input.db, clock: input.wall });
  const source = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, input.wall, tool);
  const route = new AiBusinessReadRouteAuthority(input.guard, input.authorization.credentials, input.wall);
  // Validate the real configuration producer without reading configuration or
  // granting a policy during inert construction.
  if (tool === 'tenant.opening.diagnose' || tool === 'operations.risks.list') {
    new AiGuardedQuoteCoreContextSource(input.diagnosticCore!, route);
  }
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    async register(plan, lease) {
      const task = await authorization.tasks.readMetadata(lease.taskId);
      return { taskId: lease.taskId, registrationRef: plan.registrationRef, expectedTaskRevision: task.revision,
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    },
    transition(kind, step, lease, resultRef) {
      if (kind === 'pause' || (kind !== 'start' && !resultRef)) throw unavailable();
      return { taskId: lease.taskId, stepId: step.registered.stepId,
        expectedTaskRevision: step.registered.taskRevision, expectedStepRevision: step.registered.stepRevision,
        evidenceId: kind === 'start' ? `start-${step.registered.stepId}` : resultRef!,
        reason: kind === 'start' ? 'start' : kind === 'unknown' ? 'result_unknown' : 'result_observed',
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    }
  };
  const readFacts = async (stored: { input: unknown; context: AiExecutionContext }, signal: AbortSignal) => {
        // Per-execution closure: concurrent tasks cannot swap a shared expected identity.
        const readAuthority = { withRead: route.withRead.bind(route) };
        const boundAuthority: typeof readAuthority = { withRead: (kind, request, read) =>
          route.withRead(kind, request, async context => {
            if (signal.aborted || identity(context) !== identity(stored.context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
            return read(context);
          }) };
        const diagnosticContext = tool === 'tenant.opening.diagnose' || tool === 'operations.risks.list'
          ? new AiGuardedQuoteCoreContextSource(input.diagnosticCore!, boundAuthority) : undefined;
        const result = tool === 'tenant.opening.diagnose'
          ? await new AiOpeningReadFactsService(input.business!, diagnosticContext!,
            new AiDiagnosticRouteAuthority(boundAuthority), input.wall).read(aiOpeningReadInputSchema.parse(stored.input), stored.context)
          : tool === 'operations.risks.list'
            ? await new AiRiskReadFactsService(input.reports!, {
              category: async scope => (await diagnosticContext!.current(scope)).category.code,
              currency: async scope => (await diagnosticContext!.current(scope)).settings.pricing.currency
            }, new AiDiagnosticRouteAuthority(boundAuthority), input.wall).read(aiRiskReadInputSchema.parse(stored.input), stored.context)
          : tool === 'membership.customer.resolve'
          ? await new AiMembershipCandidateReadFactsService(input.memberships!, boundAuthority, input.wall)
            .read(aiMembershipCandidateReadInputSchema.parse(stored.input), stored.context)
          : tool === 'rental.catalog.search'
          ? await new AiCatalogReadFactsService({ listItemGroups: input.core.listItemGroups!.bind(input.core),
            ...(typeof input.core.listItemGroupsPage === 'function'
              ? { listItemGroupsPage: input.core.listItemGroupsPage.bind(input.core) } : {}) }, boundAuthority, input.wall)
            .read(aiCatalogReadInputSchema.parse(stored.input))
          : tool === 'rental.availability.check'
            ? await new AiAvailabilityReadFactsService({ availability: input.core.availability!.bind(input.core) }, boundAuthority, input.wall).read(aiAvailabilityReadInputSchema.parse(stored.input))
            : await new AiOrderReadFactsService({ getOrder: input.core.getOrder!.bind(input.core) },
              new AiOrderRouteContextAuthority(input.guard, input.authorization.credentials,
                aiPersistedOrderExplainInputSchema.parse(stored.input).input.orderId, input.wall), input.wall).read(stored.context);
        if (signal.aborted) throw unavailable();
        return result;
  };
  const executors: AiTaskRegisteredExecutor = {
    async resolve(code, version) {
      if (code !== tool || version !== AI_TOOL_DRAFT_VERSION) return null;
      return { operation: 'readonly', async execute(binding, signal) {
        if (signal.aborted || binding.clarifications?.length) throw unavailable();
        const stored = await source.readForExecution(binding);
        const result = await readFacts(stored, signal);
        const current = await authorization.execution.authorize(binding.taskId);
        if (signal.aborted || identity(current) !== identity(stored.context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const payload: Prisma.InputJsonObject = JSON.parse(JSON.stringify(result));
        return { kind: 'succeeded', payload };
      } };
    }
  };
  const inputSource: AiTaskInputSource = {
    async resolve(binding) {
      const key = { taskId: binding.taskId, runId: binding.runId, inputRef: binding.inputRef, fingerprint: binding.inputHash };
      const stored = tool === 'rental.catalog.search' ? await source.readCatalogInput(key)
        : tool === 'rental.availability.check' ? await source.readAvailabilityInput(key)
          : tool === 'membership.customer.resolve' ? await source.readMembershipCandidateInput(key)
            : tool === 'tenant.opening.diagnose' ? await source.readOpeningInput(key)
              : tool === 'operations.risks.list' ? await source.readRiskInput(key) : await source.readOrderExplainInput(key);
      if (stored.registrationRef !== binding.registrationRef || binding.toolCode !== tool
        || binding.toolVersion !== AI_TOOL_DRAFT_VERSION) throw unavailable();
      return { kind: 'not_required' };
    },
    async validateAnswers() { throw unavailable(); }
  };
  const toolCatalog = { resolve: async (code: string, version: string) => code === tool && version === AI_TOOL_DRAFT_VERSION ? { modelCall: false } : null };
  const root = composeAuthorizedReadonlyPersistentTaskInputRunner({ ...input, authorization: input.authorization,
    planAuthority: source, registrationAuthority: source, inputSource, commands, executors,
    toolCatalog });
  /** Original artifact locates its exact input; the returned business facts
   * are newly authorized observations, never unchecked historic payloads. */
  const reopenBusinessSource = async (value: unknown, signal?: AbortSignal) => {
    const resourceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
    const parsed = z.object({ taskId: resourceId.max(36), resultId: resourceId.max(36) }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data, abort = signal ?? new AbortController().signal;
    if (abort.aborted) throw unavailable();
    const original = await root.results.read(command);
    if (original.status !== 'succeeded' || !original.completeMeasurement) throw unavailable();
    const binding = { taskId: command.taskId, runId: original.runId, stepId: original.stepId };
    const before = await source.readReadonlyResultInput(binding);
    const facts = await readFacts(before, abort);
    const after = await source.readReadonlyResultInput(binding), latest = await root.results.read(command);
    if (abort.aborted || identity(before.context) !== identity(after.context) || before.binding !== after.binding) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    if (requestFingerprint(original) !== requestFingerprint(latest)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    // Never return the old payload: previously visible customers/items may be
    // outside the current business scope even while Task ownership remains.
    const { payload: _historicalPayload, ...reference } = original;
    return Object.freeze({ original: reference, facts, observation: 'current_authorized_reobservation' as const,
      originalPayload: 'not_returned' as const, execution: 'not_invoked' as const });
  };
  return Object.freeze({ ...root, source, commands, executors, inputSource, toolCatalog, reopenBusinessSource });
}

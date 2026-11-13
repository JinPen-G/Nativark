/** Current-human event access locates the existing automatic Task. Preparation
 * is read-only; explicit first execution rechecks the original subject/policy,
 * and historical reads use original receipts independently of model enable. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { SubscriptionService } from '../../subscription/subscription.service';
import type { SecretBox } from '../../../common/secret-box';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiAutomationExplanationObservationDraft, AiAutomationExplanationPreparationDraft,
  AiAutomationExplanationReadDraft, AiAutomationExplanationStartDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { BusinessFailureReadAuthority } from '../business-events/business-failure-read.authority';
import type { BusinessFailureResourcePorts } from '../business-events/prisma-business-failure-outbox';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { SubscriptionBudgetEntitlementAdapter } from '../budget/budget-dependency-adapters';
import { gatewayPricingSelectionSchema } from '../budget/gateway-pricing-evidence';
import { PrismaAutomationAuthority, AutomationError } from './prisma-automation.authority';
import { OriginalAutomationCreationReader } from './original-automation-creation.reader';
import { HumanAutomationReviewService } from './human-automation-review.service';
import { AutomationTaskModelAuthority } from './automation-task-model.authority';
import { composeAutomationModelExplanation } from './automation-model-explanation.composition';
import { composeAutomationModelGateway } from './automation-model-gateway.composition';
import { createOriginalAutomationDispatchReader } from './original-automation-dispatch.reader';
import { createNativeModelAdapters } from '../native-model-adapters';
import { NATIVE_MODEL_PROTOCOLS } from '../native-model-protocols';
import type { ModelAdapter } from '../model-gateway.ports';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { HumanAutomationHttpRequest } from './human-automation-request.composition';
import type { AiTaskRunnerClock } from '../runner/ai-task-runner.ports';
import { prepareAutomationExplanationAdmission, admitOriginalAutomationExplanationStart,
  readOriginalAutomationExplanationAdmission } from './automation-explanation-start-admission';

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const configuration = z.discriminatedUnion('enabled', [z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), sceneCode: id, sceneVersion: id,
    platformProfileId: id.max(36), pricing: gatewayPricingSelectionSchema,
    maxOutputTokens: z.number().int().min(1).max(32768),
    host: z.object({ holderId: id.max(191), leaseMs: z.number().int().min(1).max(120000) }).strict() }).strict()]);
export function readAutomationExplanationConfiguration(value: unknown) {
  const selected = configuration.safeParse(structuredClone(value ?? { enabled: false }));
  if (!selected.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return selected.data;
}
const read = z.object({ inputRef: z.string().uuid() }).strict();
const startInput = read.extend({ decision: z.literal('start_original_automation_explanation'), preparation: z.unknown() }).strict();
const semantics = { readOnly: true as const, automaticRetry: false as const, executionPermission: false as const,
  businessActionRequested: false as const, businessExecution: 'not_attempted' as const };
export class AutomationExplanationApplication {
  constructor(private readonly d: { db: PrismaClient; auth: Pick<AuthService, 'resolveAccessContext'>; guard: Pick<ApiAuthGuard, 'canActivate'>;
    core: Pick<RentalCoreService, 'getOrder'>; subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
    secrets: SecretBox; resources?: BusinessFailureResourcePorts; currentConfiguration(): unknown;
    adapters?: readonly ModelAdapter[]; clock?: () => Date;
    /** Trusted server timing ports; HTTP/model fields never select them. */
    runnerClock?: AiTaskRunnerClock; monotonic?: () => number }) {}

  async call(request: HumanAutomationHttpRequest, action: 'read' | 'prepare' | 'start', value: unknown, signal?: AbortSignal) {
    const command = (action === 'start' ? startInput.parse(structuredClone(value)) : read.parse(structuredClone(value))) as
      AiAutomationExplanationReadDraft | AiAutomationExplanationStartDraft;
    const selected = { inputRef: command.inputRef };
    const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u).parse(request?.headers?.authorization);
    const clock = this.d.clock ?? (() => new Date()), requestId = randomUUID();
    let active = true;
    const close = () => { active = false; }, live = () => {
      if (!active || signal?.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    };
    signal?.addEventListener('abort', close, { once: true });
    const credentials = { current: async () => { live(); return { authorization: bearer, audience: 'operator' as const, requestId }; } };
    try {
      return await runWithRequestIdentity({}, async () => {
        live();
        const reads = new BusinessFailureReadAuthority(this.d.db, this.d.auth, credentials, this.d.guard, this.d.core, clock, this.d.resources);
        const receipt = await new OriginalAutomationCreationReader(this.d.db, reads, clock).readCreation(selected);
        if (receipt.state !== 'observed' || !receipt.task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const current = await reads.current();
        const row = await this.d.db.aiAutomationInput.findFirst({ where: { id: selected.inputRef, ...current.scope },
          select: { id: true, policyId: true, inputHash: true } });
        if (!row || row.id !== selected.inputRef) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const original = { inputRef: selected.inputRef, taskId: receipt.task.taskId, runId: receipt.task.runId };
        const source = new PrismaAutomationAuthority(this.d.db, row.policyId,
          new SubscriptionBudgetEntitlementAdapter(new PrismaSubscriptionBudgetReader(this.d.db, this.d.subscriptions, clock)), clock, reads);
        const authority = new AutomationTaskModelAuthority({ db: this.d.db, reads, source, original, clock });
        const origin = await authority.withOriginalRead(async original => original);
        const financial = createOriginalAutomationDispatchReader(this.d.db, authority);
        const reader = composeAutomationModelExplanation({ db: this.d.db, reads, source, original, authority, clock, guard: this.d.guard,
          financialEvidence: financial, gatewayScene: { sceneCode: origin.sceneCode, routeScene: 'chat', maxOutputTokens: 32768 } });
        const reviews = new HumanAutomationReviewService(this.d.db, reads, clock);
        const projection = async (observation: Awaited<ReturnType<typeof reader.read>>): Promise<AiAutomationExplanationObservationDraft> => {
          live();
          const first = await reviews.read(selected), latest = await reviews.read(selected);
          if (requestFingerprint(first) !== requestFingerprint(latest) || latest.inputHash !== origin.inputHash
            || latest.task.state !== 'observed' || latest.task.taskId !== original.taskId || latest.task.runId !== original.runId
            || latest.event.eventId !== origin.event.eventId || latest.event.resourceRevision !== origin.event.resource.version
            || latest.review.status !== 'open' && latest.review.status !== 'closed') {
            throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          }
          const currentReview: NonNullable<AiAutomationExplanationObservationDraft['currentReview']> = {
            suggestion: latest.currentSource.failed === null ? 'unavailable'
              : latest.nextAction === 'human_review' ? 'current' : 'stale',
            resourceRevision: latest.currentSource.revision, reviewStatus: latest.review.status, checkedAt: clock().toISOString() };
          live();
          const base = { original, ...semantics, source: { inputHash: origin.inputHash, event: origin.event, inputMode: origin.mode }, currentReview };
          if (observation.state === 'completed') return { ...base, state: 'completed', result: {
            resultId: observation.result.resultId, stepId: observation.result.stepId, callId: observation.result.callId,
            text: observation.result.text, semantics: observation.result.semantics } };
          if (observation.state === 'failed') return { ...base, state: 'failed', result: observation.result };
          return { ...base, state: observation.state, result: null };
        };
        const prepare = async () => {
          live();
          const published = readAutomationExplanationConfiguration(this.d.currentConfiguration());
          if (!published.enabled || published.sceneCode !== origin.sceneCode || published.sceneVersion !== origin.sceneVersion) {
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          }
          const admission = await prepareAutomationExplanationAdmission({ db: this.d.db, authority, clock });
          const current = admission.current;
          if (current.origin.bindingHash !== origin.bindingHash || current.origin.inputHash !== origin.inputHash
            || current.origin.original.runId !== original.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const result: AiAutomationExplanationPreparationDraft = { version: 'automation-explanation-preparation-1', original,
            bindingHash: origin.bindingHash, sourceHash: current.sourceHash,
            policyHash: requestFingerprint({ publication: published, plan: current.plan, admission: admission.policyHash }),
            event: current.origin.event, inputMode: current.origin.mode, expiresAt: current.origin.expiresAt,
            executionPermission: false, businessActionRequested: false, automaticRetry: false };
          live();
          if (requestFingerprint(published) !== requestFingerprint(readAutomationExplanationConfiguration(this.d.currentConfiguration()))) {
            throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          }
          return { result, admission, published };
        };
        const existingAttempt = await readOriginalAutomationExplanationAdmission({ db: this.d.db, authority });
        if (action === 'prepare') {
          if (existingAttempt) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return (await prepare()).result;
        }
        let observed = await reader.read(original);
        if (existingAttempt && observed.state === 'not_started') observed = { ...observed, state: 'unknown' };
        if (action === 'read' || observed.state !== 'not_started') { live(); return projection(observed); }
        const start = command as AiAutomationExplanationStartDraft;
        if (start.decision !== 'start_original_automation_explanation' || start.preparation?.original.inputRef !== selected.inputRef) {
          throw new AutomationError('invalid_input');
        }
        const prepared = await prepare();
        if (requestFingerprint(start.preparation) !== requestFingerprint(prepared.result)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const publication = readAutomationExplanationConfiguration(this.d.currentConfiguration());
        if (!publication.enabled || requestFingerprint(publication) !== requestFingerprint(prepared.published)) {
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        }
        const admission = await admitOriginalAutomationExplanationStart({ db: this.d.db, authority, reads, clock,
          authorityFor: db => new AutomationTaskModelAuthority({ db, reads, original, clock,
            source: new PrismaAutomationAuthority(db, row.policyId,
              new SubscriptionBudgetEntitlementAdapter(new PrismaSubscriptionBudgetReader(db, this.d.subscriptions, clock)), clock, reads) }),
          assertPublication: () => { live();
            if (requestFingerprint(publication) !== requestFingerprint(readAutomationExplanationConfiguration(this.d.currentConfiguration()))) {
              throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
            }
          } }, prepared.admission, signal);
        if (admission === 'already_recorded') {
          const found = await reader.read(original);
          live(); return projection(found.state === 'not_started' ? { ...found, state: 'unknown' } : found);
        }
        const gateway = composeAutomationModelGateway({ db: this.d.db, authorization: authority.currentAuthorization(), originalReads: authority,
          taskId: original.taskId, subscriptions: this.d.subscriptions, secrets: this.d.secrets, pricing: publication.pricing,
          platformProfileId: publication.platformProfileId,
          adapters: this.d.adapters ?? createNativeModelAdapters(NATIVE_MODEL_PROTOCOLS), clock });
        const runtime = { ...gateway.runtime, verifyEvidence: async (...args: Parameters<typeof gateway.runtime.verifyEvidence>) => {
          live();
          if (requestFingerprint(publication) !== requestFingerprint(readAutomationExplanationConfiguration(this.d.currentConfiguration()))) return false;
          const result = await gateway.runtime.verifyEvidence(...args);
          live();
          return result && requestFingerprint(publication) === requestFingerprint(readAutomationExplanationConfiguration(this.d.currentConfiguration()));
        } };
        const host = composeAutomationModelExplanation({ db: this.d.db, reads, source, original, authority, clock, guard: this.d.guard,
          runtime, priceVersion: gateway.priceVersion, financialEvidence: gateway.financialEvidence, host: publication.host,
          runnerClock: this.d.runnerClock, monotonic: this.d.monotonic,
          gatewayScene: { sceneCode: publication.sceneCode, routeScene: 'chat', maxOutputTokens: publication.maxOutputTokens } });
        const result = await host.start({ ...original, decision: 'start_original_automation_explanation' }, signal);
        live();
        return projection(result);
      });
    } finally { close(); signal?.removeEventListener('abort', close); }
  }
}

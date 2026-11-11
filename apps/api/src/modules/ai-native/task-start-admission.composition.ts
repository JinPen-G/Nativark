/** Binds an explicit original HTTP start to the existing publication/owner
 * admission participant. No policy is issued by construction or a read call.
 * The original model/R1 host still owns its own current authorization, lease,
 * budget, approval and execution checks; old CAS receipts never grant a start. */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { AiSceneCode } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from './runner/ai-task-runner.service';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { composeTaskExecutionAdmission } from './task-execution-admission.application';
import { originalRequestReferenceSchema } from './task-request/original-request.validation';
import { createCalendarOriginalRequests } from './task-calendar-original-source.composition';
import { createRuleOriginalRequests } from './task-rule-original-source.composition';

type Dependencies = Omit<AiOriginalSceneDependencies, 'credentials' | 'db'> & { db: PrismaClient };
type Request = { headers: { authorization?: unknown } };
type RulePreparation = { kind: 'business_rule'; targetId: string; version?: string };
type CalendarPreparation = { kind: 'business_calendar'; targetId: string; version: string; year: number; date: string; revision: number };

export function createOriginalTaskStartAdmission(d: Dependencies, scene: AiSceneCode) {
  return async (request: Request, value: unknown, preparation?: RulePreparation | CalendarPreparation, signal?: AbortSignal): Promise<void> => {
    const parsed = originalRequestReferenceSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192 || !/^Bearer \S+$/u.test(authorization))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    let active = !signal?.aborted, issuanceAttempted = false;
    const close = () => { active = false; }, requestId = randomUUID();
    signal?.addEventListener('abort', close, { once: true });
    const credentials = { current: async () => {
      if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { authorization, audience: 'operator' as const, requestId };
    } };
    try {
      await callAiTaskRunnerDependency(() => runWithRequestIdentity({}, async () => {
        const originals = preparation?.kind === 'business_calendar'
          ? createCalendarOriginalRequests({ ...d, credentials }, { year: preparation.year, date: preparation.date })
          : preparation?.kind === 'business_rule' && preparation.version !== undefined
            ? createRuleOriginalRequests({ ...d, credentials }, { id: preparation.targetId, version: preparation.version })
          : composeAiOriginalScenes({ ...d, credentials }).requests;
        const locator = await originals.readTaskLocator(parsed.data);
        if (locator.receipt.sceneCode !== scene || locator.receipt.state === 'revoked'
          || locator.task.state !== 'observed') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const task = locator.task;
        if (task.status !== 'queued' || task.revision !== 1 || task.plan !== 'not_observed' || task.resultAvailable) {
          // Preserve the original host's replay/recovery decision. No fresh
          // policy may be issued merely by calling start again on an old run.
          if (preparation) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          return;
        }
        const admission = composeTaskExecutionAdmission({ db: d.db, originals, clock: d.clock },
          { db: d.db, auth: d.auth, guard: d.guard, credentials, originals, clock: d.clock });
        const intent = preparation?.kind === 'business_calendar' ? 'explicit_calendar_preparation' as const
          : preparation ? 'explicit_rule_preparation' as const : 'explicit_start' as const;
        // Version pins this adapter's original rule source; the existing
        // admission participant retains its original closed rule reference.
        const admissionTarget = preparation?.kind === 'business_rule' ? { kind: preparation.kind, targetId: preparation.targetId } : preparation;
        const prepared = await admission.prepare({ original: parsed.data, intent, ...(admissionTarget ? { preparation: admissionTarget } : {}) }, signal);
        if (prepared.phase !== 'prepared' || !prepared.reference) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        // Existing current policies need no new issuance. The original guarded
        // host below remains mandatory; this is not an authorization by replay.
        if (prepared.admission === 'existing_policies_available') return;
        issuanceAttempted = true;
        const issued = await admission.issue({ reference: prepared.reference, intent }, signal);
        if (issued.phase !== 'policy_admission_recorded'
          || issued.admission !== 'current_publication_and_role_revalidated')
          throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'Original task admission requires its original receipts');
        if (!active || signal?.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }), 15000, 'original_task_admission', signal);
    } catch (error) {
      if (issuanceAttempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'Original task admission requires its original receipts');
      if (error instanceof AiTaskRunnerError && (error.code === 'AI_RUN_LIMIT' || error.code === 'AI_RESULT_UNKNOWN'))
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      throw error;
    } finally {
      active = false;
      signal?.removeEventListener('abort', close);
    }
  };
}

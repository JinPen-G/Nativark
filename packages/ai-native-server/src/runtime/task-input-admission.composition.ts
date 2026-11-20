/** Adapts existing submit/resume/continue commands inside their original HTTP
 * credential lifetime. A saved answer and an active question have distinct
 * proofs. This does not submit an answer, claim a Run, call a model or treat a
 * legacy policy receipt as execution permission. */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { isAiTaskInputSubmissionDraft, type AiTaskInputSubmissionDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from './runner/ai-task-runner.service';
import { composeTaskInputAdmission, type TaskInputAdmissionIntent } from './task-input-admission.application';
import { taskInputReceiptReferenceSchema } from './task-input/prisma-task-input.repository';
import { originalRequestReferenceSchema } from './task-request/original-request.validation';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { createOriginalSceneInputAdmissionSource, type AiOriginalSceneModelDependencies,
  type OriginalSceneInputWaitMode } from './scenes/original-scene-model.composition';
import { composeOriginalSceneKnowledge } from './scenes/original-scene-knowledge';

export interface OriginalInputContinuationConfiguration {
  db: PrismaClient;
  currentRuntimeEnabled(sceneCode: 'quote_clarification', sceneVersion: string): Promise<boolean>;
}
type Input = AiOriginalSceneDependencies & Pick<AiOriginalSceneModelDependencies, 'scene' | 'gatewayScene' | 'knowledge'>;
const commandSchema = z.object({ original: originalRequestReferenceSchema,
  submission: z.custom<AiTaskInputSubmissionDraft>(isAiTaskInputSubmissionDraft).optional(),
  reference: taskInputReceiptReferenceSchema.optional() }).strict()
  .refine(value => (value.submission !== undefined) !== (value.reference !== undefined));

export async function prepareOriginalInputContinuation(input: Input, value: unknown, intent: TaskInputAdmissionIntent,
  configuration: OriginalInputContinuationConfiguration, signal?: AbortSignal): Promise<OriginalSceneInputWaitMode> {
  const parsed = commandSchema.safeParse(structuredClone(value));
  if (!parsed.success || intent !== 'explicit_answer_continue' && !parsed.data.submission)
    throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  if (input.scene.code !== 'quote_clarification' || !Object.is(input.db, configuration.db)
    || typeof configuration.currentRuntimeEnabled !== 'function' || signal?.aborted)
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const original = parsed.data.original;
  const reference = parsed.data.reference ?? taskInputReceiptReferenceSchema.parse({
    taskId: parsed.data.submission!.taskId, requestId: parsed.data.submission!.requestId,
    expectedRevision: parsed.data.submission!.expectedRevision, submissionKey: parsed.data.submission!.submissionKey });
  let issuanceAttempted = false;
  try {
    return await callAiTaskRunnerDependency(async () => {
      const scenes = composeAiOriginalScenes(input), clock = input.clock ?? (() => new Date());
      const knowledge = input.knowledge ? composeOriginalSceneKnowledge(input.knowledge, input, clock) : undefined;
      const admission = composeTaskInputAdmission({ db: configuration.db, auth: input.auth, guard: input.guard,
        credentials: input.credentials, originals: scenes.requests, clock,
        currentRuntimeEnabled: configuration.currentRuntimeEnabled,
        inputSourceFactory: (tasks, mode) => createOriginalSceneInputAdmissionSource({ db: input.db, scenes,
          scene: input.scene, gatewayScene: input.gatewayScene, clock, knowledge }, tasks, mode) });
      const prepared = await admission.prepare({ original, intent, ...(intent === 'explicit_answer_continue'
        ? { reference } : { submission: parsed.data.submission }) }, signal);
      if (prepared.admission !== 'existing_policies_available') {
        issuanceAttempted = true;
        const issued = await admission.issue({ reference: prepared.reference, intent }, signal);
        if (issued.phase !== 'input_policy_admission_recorded'
          || issued.admission !== 'current_wait_publication_and_role_revalidated')
          throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }
      if (signal?.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      // The mode remains in this request's server memory. Actual submission and
      // successor execution still pass through the original repository/host.
      return prepared.inputWaitMode;
    }, 15000, 'original_input_admission', signal);
  } catch (error) {
    if (issuanceAttempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    if (error instanceof AiTaskRunnerError && (error.code === 'AI_RUN_LIMIT' || error.code === 'AI_RESULT_UNKNOWN'))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    throw error;
  }
}

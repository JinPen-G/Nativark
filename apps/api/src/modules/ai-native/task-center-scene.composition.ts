import { z } from 'zod';
import type { AiTaskListRepository } from './ai-task-list.repository';
import type { composeAiOriginalScenes } from './scenes/original-scenes.composition';
import { originalRequestReferenceSchema, freezeOriginalInput } from './task-request/original-request.validation';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiOriginalSceneResultService } from './scenes/original-scene-result.service';
import type { AiTaskEventRepository } from './ai-task-event.repository';
import { originalIdentityHash } from './task-request/original-request.authority';

type OriginalScenes = ReturnType<typeof composeAiOriginalScenes>;
const page = z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(512).optional(),
  status: z.string().min(1).max(64).optional(), sceneCode: z.string().min(1).max(191).optional() }).strict();
const eventRead = z.object({ original: originalRequestReferenceSchema, after: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u),
  limit: z.number().int().min(1).max(100) }).strict();

/**
 * Read-only task-center consumer. It deliberately does not become a second
 * task facade: listing, original request authorization and recovery remain in
 * their existing repositories. Model answers use the original-scene result
 * reader, not metadata, event bodies or caller-provided answers.
 */
export function composeAiTaskCenterScene(input: {
  list: Pick<AiTaskListRepository, 'readPage'>;
  events?: Pick<AiTaskEventRepository, 'readPage'>;
  modelResults?: Pick<AiOriginalSceneResultService, 'read'> & Partial<Pick<AiOriginalSceneResultService, 'reopenSource'>>;
  scenes: Pick<OriginalScenes, 'readTaskReceipt' | 'readRecovery'> & {
    requests: Pick<OriginalScenes['requests'], 'readHistorical'>;
  };
}) {
  if (!input?.list || typeof input.list.readPage !== 'function' || !input.scenes
    || typeof input.scenes.requests?.readHistorical !== 'function' || typeof input.scenes.readTaskReceipt !== 'function'
    || typeof input.scenes.readRecovery !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');

  return Object.freeze({
    readPage: async (value: unknown = {}) => {
      const parsed = page.safeParse(value);
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return input.list.readPage(parsed.data);
    },
    readEvents: async (value: unknown) => {
      const parsed = eventRead.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (typeof input.events?.readPage !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const command = freezeOriginalInput(parsed.data);
      const before = await input.scenes.requests.readHistorical(command.original);
      const task = await input.scenes.readTaskReceipt(command.original.inputRef);
      if (task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const events = await input.events.readPage({ taskId: task.taskId, after: command.after, limit: command.limit });
      const after = await input.scenes.requests.readHistorical(command.original);
      const latest = await input.scenes.readTaskReceipt(command.original.inputRef);
      if (originalIdentityHash(before.context) !== originalIdentityHash(after.context)
        || before.receipt.contentHash !== after.receipt.contentHash || after.receipt.state === 'revoked'
        || latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId
        || events.taskId !== task.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      // Return the existing formal page/reset contract unchanged. This consumer
      // never turns a cursor into Number, advances it itself, or starts a run.
      return events;
    },
    readModelResult: async (value: unknown) => {
      if (typeof input.modelResults?.read !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return input.modelResults.read(value);
    },
    reopenModelSource: async (value: unknown) => {
      if (typeof input.modelResults?.reopenSource !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return input.modelResults.reopenSource(value);
    },
    readTask: async (value: unknown) => {
      const ref = originalRequestReferenceSchema.safeParse(value);
      if (!ref.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const frozen = freezeOriginalInput(ref.data);
      const original = await input.scenes.requests.readHistorical(frozen);
      const task = await input.scenes.readTaskReceipt(frozen.inputRef);
      const recovery = task.state === 'observed' ? await input.scenes.readRecovery(frozen)
        : { nextAction: 'reconcile_request_or_explicit_create_task' as const, automaticExecution: false as const };
      const after = await input.scenes.requests.readHistorical(frozen);
      const latest = await input.scenes.readTaskReceipt(frozen.inputRef);
      if (originalIdentityHash(original.context) !== originalIdentityHash(after.context)
        || original.receipt.contentHash !== after.receipt.contentHash || after.receipt.state === 'revoked'
        || latest.state !== task.state || (latest.state === 'observed' && task.state === 'observed'
          && (latest.taskId !== task.taskId || latest.runId !== task.runId || latest.revision !== task.revision))) {
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      return freezeOriginalInput({
        original: { receipt: original.receipt, sceneCode: original.request.sceneCode,
          sceneVersion: original.receipt.sceneVersion, inputRef: original.receipt.inputRef,
          inputRevision: original.receipt.revision, inputHash: original.receipt.contentHash,
          scope: original.context.scope, audience: original.context.audience },
        task,
        recovery,
        result: { status: ('resultAvailable' in task && task.resultAvailable) ? 'available_to_authorized_result_reader' as const : 'not_available' as const,
          execution: 'not_inferred_from_metadata' as const },
        execution: 'read_only_no_start_no_reconnect_side_effect' as const
      });
    }
  });
}

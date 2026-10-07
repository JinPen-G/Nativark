import { z } from 'zod';
import type { AiTaskListRepository } from './ai-task-list.repository';
import type { composeAiOriginalScenes } from './scenes/original-scenes.composition';
import { originalRequestReferenceSchema, freezeOriginalInput } from './task-request/original-request.validation';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiOriginalSceneResultService } from './scenes/original-scene-result.service';

type OriginalScenes = ReturnType<typeof composeAiOriginalScenes>;
const page = z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(512).optional(),
  status: z.string().min(1).max(64).optional(), sceneCode: z.string().min(1).max(191).optional() }).strict();

/**
 * Read-only task-center consumer. It deliberately does not become a second
 * task facade: listing, original request authorization and recovery remain in
 * their existing repositories. Model answers use the original-scene result
 * reader, not metadata, event bodies or caller-provided answers.
 */
export function composeAiTaskCenterScene(input: {
  list: Pick<AiTaskListRepository, 'readPage'>;
  modelResults?: Pick<AiOriginalSceneResultService, 'read'>;
  scenes: Pick<OriginalScenes, 'readTaskReceipt' | 'readRecovery'> & {
    requests: Pick<OriginalScenes['requests'], 'readHistorical'>;
  };
}) {
  if (!input?.list || typeof input.list.readPage !== 'function' || !input.scenes
    || typeof input.scenes.requests?.readHistorical !== 'function' || typeof input.scenes.readTaskReceipt !== 'function'
    || typeof input.scenes.readRecovery !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');

  return Object.freeze({
    readPage: async (value: unknown = {}) => input.list.readPage(page.parse(value)),
    readModelResult: async (value: unknown) => {
      if (typeof input.modelResults?.read !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return input.modelResults.read(value);
    },
    readTask: async (value: unknown) => {
      const ref = originalRequestReferenceSchema.safeParse(value);
      if (!ref.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const frozen = freezeOriginalInput(ref.data);
      const original = await input.scenes.requests.readHistorical(frozen);
      const task = await input.scenes.readTaskReceipt(frozen.inputRef);
      const recovery = task.state === 'observed' ? await input.scenes.readRecovery(frozen)
        : { nextAction: 'reconcile_request_or_explicit_create_task' as const, automaticExecution: false as const };
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

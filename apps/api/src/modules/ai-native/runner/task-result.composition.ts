import type { PrismaClient } from '@prisma/client';
import { AiTaskRepository } from '../ai-task.repository';
import { AiTaskResultRepository } from './ai-task-result.repository';

export interface AiTaskResultComposition {
  db: Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiStep' | 'aiTaskResultArtifact' | 'aiRun'>;
  tasks: AiTaskRepository;
  clock?: () => Date;
}

/** Explicit, opt-in read composition. It registers no route or worker. */
export function composeAiTaskResultReader(input: AiTaskResultComposition) {
  if (!input?.db || !input.tasks) throw new Error('AI_RESULT_READER_UNAVAILABLE');
  return new AiTaskResultRepository(input.db, input.tasks, input.clock);
}

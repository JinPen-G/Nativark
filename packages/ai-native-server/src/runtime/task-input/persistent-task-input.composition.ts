import { AiTaskRepositoryError } from '../ai-task.repository';
import { composePersistentTaskRunner, type PersistentTaskRunnerComposition } from '../runner/persistent-task-runner.composition';
import { PrismaTaskInputRepository } from './prisma-task-input.repository';
import type { AiTaskInputSource } from './task-input.ports';

export function composePersistentTaskInputRunner(input: Omit<PersistentTaskRunnerComposition, 'inputs'> & { inputSource: AiTaskInputSource }) {
  if (!input?.inputSource) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const inputs = new PrismaTaskInputRepository(input.db, input.tasks, input.planAuthority, input.inputSource, input.wall);
  return { ...composePersistentTaskRunner({ ...input, inputs }), inputs };
}

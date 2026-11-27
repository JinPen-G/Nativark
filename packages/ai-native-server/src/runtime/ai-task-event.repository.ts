/** Legacy Task projection retains the registered Rental result categories. */
import { AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE } from '@rental-os/platform-contracts/ai-task';
import { AiTaskRepository, type AiTaskRepositoryAuthority } from './ai-task.repository';
import { TaskEventReader, type TaskEventDatabase } from './task-event-reader';
export { projectAiTaskWireEvent } from './task-event-projection';

export class AiTaskEventRepository extends TaskEventReader {
  constructor(db: TaskEventDatabase, authority: AiTaskRepositoryAuthority, clock: () => Date = () => new Date()) {
    super(db, new AiTaskRepository(db, authority, clock), code => {
      if (code === 'rental.order.commit' || code === 'tenant.notifications.commit') return 'confirmation';
      if ([AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE].some(model => model === code)) return 'model';
    });
  }
}

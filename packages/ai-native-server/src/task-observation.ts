/** Owner-scoped original Task list, snapshot and event observations. The host
 * supplies current list/read actions and the published tool result categories. */
import { AiTaskListRepository, type AiTaskListAuthority } from './runtime/ai-task-list.repository';
import { TaskEventReader, type TaskEventDatabase, type TaskResultKind } from './runtime/task-event-reader';
import { aiTaskAccessFromContext } from './runtime/task-owner-access';
import type { AiTaskRepositoryAuthority } from './task-persistence';
import { AiTaskRepositoryError } from './task-errors';

export { aiTaskMetadataQuerySchema, type AiTaskListAuthority } from './runtime/ai-task-list.repository';
export { TaskEventReader, type TaskEventDatabase, type TaskResultKind } from './runtime/task-event-reader';
export { aiTaskAccessFromContext } from './runtime/task-owner-access';

export function createPublicTaskObservation(input: { db: TaskEventDatabase;
  actions: AiTaskRepositoryAuthority; list: AiTaskListAuthority['resolveList']; resultKind: TaskResultKind; clock?: () => Date }) {
  const { db, actions, list, resultKind } = input, clock = input.clock ?? (() => new Date());
  if (typeof actions?.resolve !== 'function' || typeof list !== 'function' || typeof resultKind !== 'function')
    throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const rows = new AiTaskListRepository(db, { resolveList: list, authorizeMetadata: id => actions.resolve(id, 'read_metadata') }, clock);
  const read = new TaskEventReader(db, { async resolveAccess(taskId, operation) {
    try { return aiTaskAccessFromContext(await actions.resolve(taskId, operation), taskId, clock()); }
    catch { throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); }
  } }, resultKind);
  return Object.freeze({ list: rows.readPage.bind(rows), snapshot: (query: unknown) => read.readSnapshot(query, true), events: read.readPage.bind(read) });
}

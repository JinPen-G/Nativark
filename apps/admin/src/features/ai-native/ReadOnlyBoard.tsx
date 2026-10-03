import { TaskList } from './TaskList';
import { TaskTimeline } from './TaskTimeline';
import { ModelText } from './ModelText';
export interface ReadOnlyBoardProps { tasks?: readonly unknown[]; taskId: string; steps?: readonly unknown[]; modelText: string; }
/** Offline host composition only. It owns no transport, authorization or mutation. */
export function ReadOnlyBoard({ tasks, taskId, steps, modelText }: ReadOnlyBoardProps) { return <section aria-label="AI 只读工作台"><TaskList tasks={tasks} page={1} /><TaskTimeline taskId={taskId} steps={steps} /><ModelText text={modelText} /></section>; }

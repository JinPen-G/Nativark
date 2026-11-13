/** Explicit operator controls for a new pure model Run in the original Task.
 * These references grant no business retry, approval or new resource allowance. */
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_WORKBENCH_MODEL_CONTROL_VERSION = 'workbench-model-control-1' as const;
export type AiWorkbenchModelControlKind = 'reinterpret' | 'reformat';
export interface AiWorkbenchModelControlReference { taskId: string; operationId: string }
export interface AiWorkbenchModelControlCommand extends AiWorkbenchModelControlReference {
  kind: AiWorkbenchModelControlKind; expectedTaskRevision: number;
  sourceRunId: string; sourceResultId: string; expectedPresentationRevision: number;
}
export interface AiWorkbenchModelControlPreparation {
  version: typeof AI_WORKBENCH_MODEL_CONTROL_VERSION; taskId: string;
  expectedTaskRevision: number; sourceRunId: string; sourceResultId: string; expectedPresentationRevision: number;
  kinds: AiWorkbenchModelControlKind[]; semantics: 'current_original_source_not_model_permission';
}
export interface AiWorkbenchModelControlObservation extends AiWorkbenchModelControlReference {
  version: typeof AI_WORKBENCH_MODEL_CONTROL_VERSION;
  status: 'not_observed' | 'registered' | 'running' | 'available' | 'failed' | 'unknown';
  operationLogId?: string; kind?: AiWorkbenchModelControlKind; runId?: string;
  sourceRunId?: string; sourceResultId?: string; resultId?: string; presentationRevision?: number;
  nextAction: 'read_original_operation';
}
const key = { ...id(), maxLength: 36 }, operationId = { ...id(), maxLength: 128 };
const revision = integer(1, 4294967294), version = choice(AI_WORKBENCH_MODEL_CONTROL_VERSION);
const kind = choice('reinterpret', 'reformat');
const reference = { taskId: key, operationId };
const source = { expectedTaskRevision: revision, sourceRunId: key, sourceResultId: key, expectedPresentationRevision: revision };
const observation = { ...reference, version, nextAction: choice('read_original_operation') };
const observed = { ...observation, operationLogId: key, kind, runId: key,
  sourceRunId: key, sourceResultId: key, presentationRevision: revision };
export const AI_WORKBENCH_MODEL_CONTROL_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiWorkbenchModelControlReference: object(reference),
  AiWorkbenchModelControlCommand: object({ ...reference, kind, ...source }),
  AiWorkbenchModelControlPreparation: object({ version, taskId: key, ...source,
    kinds: { ...list(kind, 2, 1), uniqueItems: true }, semantics: choice('current_original_source_not_model_permission') }),
  AiWorkbenchModelControlObservation: { oneOf: [
    object({ ...observation, status: choice('not_observed') }),
    object({ ...observed, status: choice('registered', 'running', 'failed', 'unknown') },
      [...Object.keys(observation), 'operationLogId', 'kind', 'runId', 'presentationRevision', 'status']),
    object({ ...observed, status: choice('available'), resultId: key }),
  ] },
};

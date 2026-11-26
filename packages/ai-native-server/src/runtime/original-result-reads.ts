/** Shared original-result association, independent of web tokens and business DTOs.
 * Only use original, owner-authorized readers scoped to the active host callback. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS, type AiConversationModelResultReadDraft,
  type AiConversationTurnReferenceDraft, type AiSceneRequestReadDraft } from '@rental-os/platform-contracts/ai-original-result';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiTaskRepositoryError } from '../task-errors';

const ajv = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv);
const validConversation = ajv.compile<AiConversationModelResultReadDraft>(AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS.AiConversationModelResultReadDraft);
const validOriginalInput = ajv.compile<AiSceneRequestReadDraft>(AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS.AiSceneRequestReadDraft);
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

/** Gates use a trusted owner lease, not a locator's fields. Run before storage
 * and again at delivery, including late results of cancelled callbacks. */
export interface AiOriginalResultReadLease {
  assertCurrent(): void | Promise<void>;
}

interface TurnLocator {
  admissionKey: string;
  material: 'retained' | 'erased';
  original: AiSceneRequestReadDraft;
  originalRequestKey: string;
  capabilityCode: string;
  capabilityVersion: string;
  task: { taskId: string; runId: string } | null;
}
interface ResultLocator {
  resultId: string;
  taskId: string;
  sceneCode: string;
  original: { inputRef: string; requestKey: string; sceneVersion: string };
}

export function createOriginalConversationResultRead<Turn extends TurnLocator, Result extends ResultLocator>(source: AiOriginalResultReadLease & {
  readAdmission(reference: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<AiConversationTurnReferenceDraft & { result: Turn | null }>;
  /** Original Task/step/artifact reader verifies lineage, ACL and content. */
  readModelResult(reference: { original: AiSceneRequestReadDraft; resultId: string }, signal: AbortSignal): Promise<Result>;
}) {
  const { check, readAdmission, readModelResult } = { check: source.assertCurrent.bind(source),
    readAdmission: source.readAdmission.bind(source), readModelResult: source.readModelResult.bind(source) };
  return async (value: unknown, signal: AbortSignal) => {
    const command: unknown = structuredClone(value);
    if (!validConversation(command)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const live = async () => {
      if (signal.aborted) throw denied();
      await check();
      if (signal.aborted) throw denied();
    };
    const { resultId, ...reference } = command;
    await live();
    const before = structuredClone(await readAdmission(reference, signal)), turn = before.result;
    await live();
    if (!turn?.task || !validOriginalInput(turn.original) || before.draftVersion !== reference.draftVersion
      || before.conversationId !== reference.conversationId || before.admissionKey !== reference.admissionKey
      || turn.admissionKey !== reference.admissionKey) throw unavailable();
    const base = { ...reference, turn, execution: 'read_only_no_start_no_dispatch' as const };
    if (turn.material === 'erased') return { ...base, status: 'material_erased' as const, result: null, nextAction: 'original_task_center' as const };
    if (turn.material !== 'retained') throw unavailable();
    const result = structuredClone(await readModelResult({ original: turn.original, resultId }, signal));
    await live();
    if (result.original.inputRef !== turn.original.inputRef || result.original.requestKey !== turn.originalRequestKey
      || result.sceneCode !== turn.capabilityCode || result.original.sceneVersion !== turn.capabilityVersion
      || result.taskId !== turn.task.taskId || result.resultId !== resultId) throw unavailable();
    const after = await readAdmission(reference, signal);
    await live();
    if (requestFingerprint(after) !== requestFingerprint(before)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    return { ...base, status: 'observed' as const, result };
  };
}

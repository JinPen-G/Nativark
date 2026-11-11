/** Original notification-change transport. Requests use the published shared
 * contracts and current session; reads never prepare, create, start or approve.
 * The original Controllers validate replies and own every business mutation. */
import { AI_SCENE_MODEL_HTTP_DRAFT as routes, type ApiResult,
  type AiApprovedSettingsCurrentDraft, type AiApprovedSettingsChangePrepareDraft,
  type AiApprovedSettingsChangePreparationResultDraft, type AiApprovedSettingsChangeReceiptDraft,
  type AiApprovedSettingsTaskCreationDraft, type AiApprovedSettingsTaskCreatedDraft,
  type AiApprovedSettingsTaskCreationReadDraft, type AiApprovedSettingsTaskRunDraft,
  type AiApprovedSettingsTaskResultDraft, type AiApprovedSettingsTaskConfirmationReadDraft } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { http } from './http';

type Action = 'readCurrentSettings' | 'prepareOriginalSettingsChange' | 'readOriginalSettingsChange'
  | 'createSettingsTask' | 'readSettingsTaskCreation' | 'startOriginalSettingsTask'
  | 'readOriginalSettingsResult' | 'readOriginalSettingsConfirmation';
const post = async <T>(action: Action, body: unknown, signal: AbortSignal): Promise<T> => {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const result = await http.post<ApiResult<T>>(`/${routes.basePath}/${routes[action]}`, structuredClone(body),
    { signal: active, timeout: action === 'startOriginalSettingsTask' ? 120000 : 12000 });
  if (active.aborted || currentSessionEpoch() !== epoch) throw Error('AI_SCOPE_CHANGED');
  return result.data.data;
};

export const aiNotificationChangesApi = Object.freeze({
  current: (signal: AbortSignal) => post<AiApprovedSettingsCurrentDraft>('readCurrentSettings', {}, signal),
  prepare: (command: AiApprovedSettingsChangePrepareDraft, signal: AbortSignal) =>
    post<AiApprovedSettingsChangePreparationResultDraft>('prepareOriginalSettingsChange', command, signal),
  change: (changeKey: string, signal: AbortSignal) =>
    post<AiApprovedSettingsChangeReceiptDraft>('readOriginalSettingsChange', { changeKey }, signal),
  create: (original: AiApprovedSettingsTaskCreationDraft, signal: AbortSignal) =>
    post<AiApprovedSettingsTaskCreatedDraft>('createSettingsTask', original, signal),
  creation: (original: AiApprovedSettingsTaskCreationDraft, signal: AbortSignal) =>
    post<AiApprovedSettingsTaskCreationReadDraft>('readSettingsTaskCreation', original, signal),
  start: (original: AiApprovedSettingsTaskCreationDraft, signal: AbortSignal) =>
    post<AiApprovedSettingsTaskRunDraft>('startOriginalSettingsTask', original, signal),
  result: (original: AiApprovedSettingsTaskCreationDraft, signal: AbortSignal) =>
    post<AiApprovedSettingsTaskResultDraft>('readOriginalSettingsResult', original, signal),
  confirmation: (original: AiApprovedSettingsTaskCreationDraft, signal: AbortSignal) =>
    post<AiApprovedSettingsTaskConfirmationReadDraft>('readOriginalSettingsConfirmation', original, signal)
});

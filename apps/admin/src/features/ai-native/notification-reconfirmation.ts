/** Adapts the published notification reconfirmation observations. Only the
 * original domain proves no-submission closure and prepares the new change;
 * attaching it does not create/start a Task or inherit the old approval. */
import type { AiApprovedSettingsTaskCreationDraft, AiSettingsReconfirmationDifferenceDraft,
  AiSettingsReconfirmationObservationDraft, AiSettingsReconfirmationPreparedDraft,
  AiSettingsReconfirmationReviewDraft } from '@rental-os/shared';
import type { aiNotificationChangesApi } from '@/api/aiNotificationChanges';
import { notificationOriginalLocator, sameNotificationOriginal, inspectNotificationChange,
  inspectNotificationCurrent, inspectNotificationValues } from './notification-change-session';
import type { createNotificationChangeSession } from './notification-change-session';
import type { OriginalReconfirmationPort } from './original-reconfirmation-session';

type Prepared = Pick<AiSettingsReconfirmationPreparedDraft, 'original' | 'reference' | 'change'>;
type Values = Omit<AiSettingsReconfirmationReviewDraft, 'original'>;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key =>
    [key, canonical((value as Record<string, unknown>)[key])])) : value;
const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export function notificationReconfirmationPort(input: { api: typeof aiNotificationChangesApi;
  session: ReturnType<typeof createNotificationChangeSession>; clock?: () => Date }):
  OriginalReconfirmationPort<AiApprovedSettingsTaskCreationDraft, AiSettingsReconfirmationObservationDraft,
    Values, AiSettingsReconfirmationDifferenceDraft, Prepared> {
  const reference = (value: Prepared) => {
    const original = notificationOriginalLocator.parse(value.original), replacement = notificationOriginalLocator.parse(value.reference);
    if (sameNotificationOriginal(original, replacement)) throw Error('AI_SCOPE_CHANGED');
    inspectNotificationChange(value.change); return replacement;
  };
  const observation = (value: AiSettingsReconfirmationObservationDraft, original: AiApprovedSettingsTaskCreationDraft) => {
    if (!value || !sameNotificationOriginal(original, notificationOriginalLocator.parse(value.original))
      || value.execution !== 'read_only_no_preparation_or_dispatch' || value.automaticRetry !== false) throw Error('AI_SCOPE_CHANGED');
    notificationOriginalLocator.parse(value.reference);
    if (value.receipt.state === 'prepared_not_approved') {
      const prepared = { original: value.original, reference: value.reference, change: inspectNotificationChange(value.receipt.change) };
      reference(prepared); return prepared;
    }
    if (value.receipt.state !== 'not_observed' || value.receipt.nextAction !== 'read_change_receipt') throw Error('AI_RESOURCE_UNAVAILABLE');
    return null;
  };
  const revalidateReview = (value: AiSettingsReconfirmationDifferenceDraft) => {
    notificationOriginalLocator.parse(value.original); inspectNotificationChange(value.previous);
    const current = inspectNotificationCurrent(value.current), field = value.fields?.[0];
    if (!field || value.fields.length !== 1 || field.field !== 'notifications' || typeof value.originalBaseMatches !== 'boolean'
      || !same(inspectNotificationValues(field.before), current.notifications)
      || same(inspectNotificationValues(field.after), current.notifications) || !/^[a-f0-9]{64}$/u.test(value.reviewHash)
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= (input.clock ?? (() => new Date()))().getTime()
      || value.persistence !== 'not_attempted' || value.approval !== 'not_granted' || value.automaticRetry !== false)
      throw Error('AI_REVISION_CONFLICT');
  };
  return {
    async read(original, signal) {
      const found = await input.api.readReconfirmation(original, signal), prepared = observation(found, original);
      return { current: structuredClone(found), prepared };
    },
    async review(original, values, signal) {
      const found = await input.api.inspectReconfirmation({ original, ...values }, signal);
      if (!sameNotificationOriginal(original, found.original) || found.expiresAt !== values.expiresAt
        || !same(found.fields?.[0]?.after, values.notifications)) throw Error('AI_SCOPE_CHANGED');
      revalidateReview(found); return found;
    },
    async prepare(original, review, signal) {
      revalidateReview(review);
      if (!sameNotificationOriginal(original, review.original)) throw Error('AI_SCOPE_CHANGED');
      const found = await input.api.prepareReconfirmation({ original, notifications: review.fields[0].after,
        expiresAt: review.expiresAt, reviewHash: review.reviewHash, decision: 'prepare_reconfirmed_notification_change' }, signal);
      reference(found);
      if (!sameNotificationOriginal(original, found.original) || found.closure?.state !== 'closed_no_business_submission'
        || !Number.isInteger(found.closure.taskRevision) || found.closure.taskRevision < 1
        || !found.closure.taskId || !found.closure.runId || found.task !== 'not_created_by_preparation'
        || found.approval !== 'fresh_proposal_and_approval_required' || found.oldResources !== 'not_reset_or_reallocated'
        || found.automaticRetry !== false || found.change.baseRevision !== review.current.settingsRevision
        || found.change.expiresAt !== review.expiresAt
        || !same(found.change.diff['notifications.enabledEvents'], { before: review.fields[0].before.enabledEvents, after: review.fields[0].after.enabledEvents })
        || !same(found.change.diff['notifications.editableChannels'], { before: review.fields[0].before.editableChannels, after: review.fields[0].after.editableChannels }))
        throw Error('AI_RESULT_UNKNOWN');
      return { original: found.original, reference: found.reference, change: found.change };
    },
    replacement: reference, revalidateReview,
    async attach(prepared, signal) { input.session.attachReconfirmed(prepared, signal); await input.session.read(prepared.reference, signal); },
    async completed(original, signal) {
      const change = await input.api.change(original.changeKey, signal);
      if (signal.aborted) throw Error('AI_SCOPE_CHANGED');
      if (change.state !== 'prepared_not_approved') return false;
      const material = inspectNotificationChange(change.change), result = await input.api.result(original, signal);
      if (signal.aborted) throw Error('AI_SCOPE_CHANGED');
      return result.businessOutcome === 'committed' && result.execution === 'not_invoked' && result.automaticRetry === false
        && !!result.operation && result.operation.changeId === material.changeId && result.operation.changeHash === material.changeHash
        && result.operation.baseRevision === material.baseRevision && result.operation.resultRevision === material.baseRevision + 1;
    }
  };
}

/** Binds the published name reconfirmation replies to the original workflow.
 * The server proves closure and issues the replacement locator. Local review,
 * attachment and receipt reads never create, approve or execute that Task. */
import { aiMemberNameResponse, type AiMemberNameLocator, type AiMemberNameResponse } from '@rental-os/shared';
import type { aiMemberNameApi } from '@/api/aiMemberName';
import { sameMemberNameLocator } from './member-name-session';
import type { createMemberNameSession } from './member-name-session';
import type { OriginalReconfirmationPort } from './original-reconfirmation-session';

export function memberNameReconfirmationPort(input: { tenantId: string; api: typeof aiMemberNameApi;
  session: ReturnType<typeof createMemberNameSession>; clock?: () => Date }):
  OriginalReconfirmationPort<AiMemberNameLocator, AiMemberNameResponse, string, AiMemberNameResponse, AiMemberNameResponse> {
  const frame = (value: AiMemberNameResponse, original?: AiMemberNameLocator) => {
    const found = aiMemberNameResponse.parse(structuredClone(value));
    if (found.scope.tenantId !== input.tenantId || original && (!found.reconfirmation
      || !sameMemberNameLocator(original, found.reconfirmation.originalLocator))) throw Error('AI_SCOPE_CHANGED');
    return found;
  };
  const replacement = (value: AiMemberNameResponse) => {
    const found = frame(value), link = found.reconfirmation;
    if (!link || link.preparation !== 'prepared' || !link.newLocator || link.newLocator.kind !== 'reconfirmed'
      || !sameMemberNameLocator(link.newLocator, found.locator) || !found.change
      || link.originalLocator.customerId !== link.newLocator.customerId
      || sameMemberNameLocator(link.originalLocator, link.newLocator) || found.phase === 'not_observed') throw Error('AI_RESOURCE_UNAVAILABLE');
    return structuredClone(link.newLocator);
  };
  const revalidateReview = (value: AiMemberNameResponse) => {
    const found = frame(value), link = found.reconfirmation, review = link?.review;
    if (!found.newWorkEnabled || found.phase !== 'reconfirmation_difference_ready' || !link || !review
      || link.preparation !== 'not_attempted' || link.newLocator !== null
      || !sameMemberNameLocator(link.originalLocator, found.locator) || !found.change
      || review.name !== found.change.after || review.current.after !== review.name
      || review.expiresAt !== review.current.expiresAt || review.current.expiresAt !== found.change.expiresAt
      || review.current.baseRevision !== found.change.baseRevision || review.current.before !== found.change.before
      || review.current.before === review.name || Date.parse(review.expiresAt) <= (input.clock ?? (() => new Date()))().getTime())
      throw Error('AI_REVISION_CONFLICT');
  };
  return {
    async read(original, signal) {
      const found = frame(await input.api.readReconfirmation(original, signal), original);
      if (found.reconfirmation?.preparation === 'prepared') { replacement(found); return { current: found, prepared: found }; }
      if (found.reconfirmation?.preparation !== 'not_observed' || found.reconfirmation.newLocator !== null
        || !sameMemberNameLocator(original, found.locator)) throw Error('AI_RESOURCE_UNAVAILABLE');
      return { current: found, prepared: null };
    },
    async review(original, name, signal) {
      const found = frame(await input.api.inspectReconfirmation({ locator: original, name }, signal), original);
      revalidateReview(found); return found;
    },
    async prepare(original, value, signal) {
      revalidateReview(value); const review = value.reconfirmation!.review!;
      const found = frame(await input.api.prepareReconfirmation({ locator: original, name: review.name,
        expiresAt: review.expiresAt, reviewHash: review.reviewHash, decision: 'prepare_reconfirmed_member_name_change' }, signal), original);
      replacement(found);
      if (!found.reconfirmation?.closure || found.change!.after !== review.name || found.change!.expiresAt !== review.expiresAt)
        throw Error('AI_RESULT_UNKNOWN');
      return found;
    },
    replacement, revalidateReview,
    async attach(prepared, signal) { input.session.attachReconfirmed(prepared, signal); },
    async completed(reference, signal) {
      const found = frame(await input.api.read(reference, signal));
      if (!sameMemberNameLocator(reference, found.locator)) throw Error('AI_SCOPE_CHANGED');
      return found.phase === 'completed' && !!found.change && !!found.operation
        && found.operation.resultName === found.change.after && found.operation.resultRevision === found.change.baseRevision + 1;
    }
  };
}

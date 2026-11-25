import type { AiPreferenceValueDraft } from '@rental-os/shared';
import { fingerprint } from './knowledge-validation';

/** Only describes different confirmed candidates in the RETURNED bounded set.
 * No latest-wins policy or Core/business compatibility decision is invented.
 */
export function preferenceAmbiguities(items: ReadonlyArray<{ memoryId: string; preference: AiPreferenceValueDraft }>) {
  const kinds = ['locale', 'fulfillment_location', 'display_density'] as const;
  return kinds.flatMap(kind => {
    const candidates = items.filter(item => item.preference.kind === kind);
    return new Set(candidates.map(item => fingerprint(item.preference))).size > 1
      ? [{ kind, memoryIds: candidates.map(item => item.memoryId), nextStep: 'human_selection' as const }] : [];
  });
}

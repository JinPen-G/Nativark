/** Local recovery references for the original name/notification reconfirmation.
 * Persisting a phase proves neither Task closure nor a prepared replacement.
 * Every reopen reads the original server receipt; unknown phases never resend. */
import { z } from 'zod';

export type OriginalReconfirmationJournal<Reference> = {
  original: Reference;
  replacement: Reference | null;
  phase: 'read_original' | 'prepare' | 'prepared' | 'handoff' | 'attached';
};
export type OriginalReconfirmationStore<Reference> = {
  read(): OriginalReconfirmationJournal<Reference> | null;
  write(value: OriginalReconfirmationJournal<Reference>, expected: OriginalReconfirmationJournal<Reference> | null): void;
  clear(expected: OriginalReconfirmationJournal<Reference>): void;
};

export function originalReconfirmationStore<S extends z.ZodTypeAny>(key: string, reference: S,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): OriginalReconfirmationStore<z.infer<S>> {
  const schema = z.object({ original: reference, replacement: reference.nullable(),
    phase: z.enum(['read_original', 'prepare', 'prepared', 'handoff', 'attached']) }).strict().superRefine((value, context) => {
    if ((value.phase === 'read_original' || value.phase === 'prepare') !== (value.replacement === null))
      context.addIssue({ code: 'custom', message: 'Original reconfirmation reference phase mismatch' });
  });
  const encode = (value: OriginalReconfirmationJournal<z.infer<S>>) => JSON.stringify(schema.parse(structuredClone(value)));
  const read = (): OriginalReconfirmationJournal<z.infer<S>> | null => {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (!raw || raw.length > 1200) throw Error('AI_OPERATION_LOCATOR_DAMAGED');
    try {
      const found = schema.parse(JSON.parse(raw));
      // Zod's generic object output makes unknown schema fields optional in
      // TypeScript. Reparse the concrete formal reference at this boundary.
      return { original: reference.parse(found.original), replacement: found.replacement === null ? null : reference.parse(found.replacement),
        phase: found.phase };
    }
    catch { throw Error('AI_OPERATION_LOCATOR_DAMAGED'); }
  };
  return { read,
    write(value, expected) {
      if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      if (storage.getItem(key) !== (expected ? encode(expected) : null)) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
      const raw = encode(value);
      if (raw.length > 1200) throw Error('AI_OPERATION_LOCATOR_DAMAGED');
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('AI_OPERATION_LOCATOR_UNCONFIRMED');
    },
    clear(expected) {
      if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      const raw = storage.getItem(key);
      // Only an original verified completion can finish partial local cleanup.
      // A competing page's new unknown locator must remain untouched.
      if (raw === null) return;
      if (raw !== encode(expected)) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
      storage.removeItem(key);
      if (storage.getItem(key) !== null) throw Error('AI_OPERATION_LOCATOR_UNCONFIRMED');
    }
  };
}

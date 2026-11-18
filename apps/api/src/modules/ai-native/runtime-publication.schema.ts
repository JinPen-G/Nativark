import { z } from 'zod';

const configuration = z.record(z.unknown()).optional();
const configurations = z.object({
  entryActions: configuration,
  conversations: configuration,
  workbenchDisplay: configuration,
  businessFailure: configuration,
  automationExplanation: configuration,
  automationReviewGrant: configuration,
  orderModel: configuration,
  quoteModel: configuration,
  openingModel: configuration,
  openingProposals: configuration,
  quoteOrderExecution: configuration,
  settingsExecution: configuration,
  businessRuleDraft: configuration,
  calendarDraft: configuration,
  memberName: configuration,
  capabilityProbe: configuration,
  platformCapabilityProbe: configuration,
  inputCounting: configuration,
  gatewayCapacity: configuration,
  taskFaultDiagnostics: configuration,
  budgetManagement: configuration,
  clientModel: configuration,
  clientPublic: configuration,
  clientTaskPolicy: configuration,
  staffRecognition: configuration,
  staffManual: configuration,
  categoryDraft: configuration,
  categoryProposal: configuration,
  // Keep the catalog's common record type while the restore section stays closed at runtime.
  retentionRestore: z.object({ publicKeyHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
    .and(z.record(z.unknown())).optional(),
}).strict();
const publicationSchema = z.object({
  version: z.literal('ain-runtime-publication-1'),
  revision: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  configurations,
}).strict();

type Publication = z.infer<typeof publicationSchema>;
export type ConfigurationName = keyof Publication['configurations'];
export type RuntimePublication = Readonly<{
  state: 'configured' | 'unconfigured';
  revision: string | null;
  configurations: Publication['configurations'];
}>;

export function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

/** Deployment input is JSON, never a path to open or code to evaluate. A missing
 * section stays absent: enabling a model does not enable paid probes, counting,
 * order creation, draft saves, setting changes, client policy management or
 * staff manual operations on its behalf. */
export function parseRuntimePublication(raw: unknown): RuntimePublication {
  if (raw === undefined || raw === '') return immutable({ state: 'unconfigured', revision: null, configurations: {} });
  try {
    const value: unknown = typeof raw === 'string' ? raw : structuredClone(raw);
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text || Buffer.byteLength(text, 'utf8') > 65536) throw new Error();
    const parsed = publicationSchema.safeParse(typeof value === 'string' ? JSON.parse(value) : value);
    if (!parsed.success) throw new Error();
    return immutable({ state: 'configured', revision: parsed.data.revision, configurations: parsed.data.configurations });
  } catch {
    // Do not expose the supplied JSON, credentials, parser messages or values.
    throw new Error('AI_RUNTIME_PUBLICATION_INVALID');
  }
}

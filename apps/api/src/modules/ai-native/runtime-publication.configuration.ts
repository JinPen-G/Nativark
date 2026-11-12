/** Reads the versioned server deployment publication through the existing
 * ConfigService. Each consumer retains its own closed configuration schema,
 * current permissions, persisted policies and Gateway/Core checks. This source
 * neither publishes database policy nor starts work or supplies credentials. */
import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AiTaskRepositoryError } from './ai-task.repository';

export const AI_NATIVE_RUNTIME_PUBLICATION = Symbol('AI_NATIVE_RUNTIME_PUBLICATION');
export const AI_NATIVE_RUNTIME_PUBLICATION_KEY = 'AI_NATIVE_RUNTIME_PUBLICATION';

const configuration = z.record(z.unknown()).optional();
const configurations = z.object({
  conversations: configuration,
  workbenchDisplay: configuration,
  businessFailure: configuration,
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
  budgetManagement: configuration,
  clientModel: configuration,
  clientTaskPolicy: configuration,
  staffRecognition: configuration,
  staffManual: configuration,
}).strict();
const publicationSchema = z.object({
  version: z.literal('ain-runtime-publication-1'),
  revision: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  configurations,
}).strict();

type Publication = z.infer<typeof publicationSchema>;
type ConfigurationName = keyof Publication['configurations'];
export type RuntimePublication = Readonly<{
  state: 'configured' | 'unconfigured';
  revision: string | null;
  configurations: Publication['configurations'];
}>;

function immutable<T>(value: T): T {
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
export function readRuntimePublication(source: Pick<ConfigService, 'get'>): RuntimePublication {
  const raw: unknown = source.get(AI_NATIVE_RUNTIME_PUBLICATION_KEY);
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
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
}

export const AI_NATIVE_RUNTIME_PUBLICATION_PROVIDER: FactoryProvider<RuntimePublication> = {
  provide: AI_NATIVE_RUNTIME_PUBLICATION,
  inject: [ConfigService],
  useFactory: readRuntimePublication,
};

/** Only the fixed provider registry may select a section; HTTP/model input
 * cannot choose its own token. Return separate snapshots to each original host. */
export function runtimeConfigurationProvider(token: symbol, name: ConfigurationName): FactoryProvider {
  return {
    provide: token,
    inject: [AI_NATIVE_RUNTIME_PUBLICATION],
    useFactory: (publication: RuntimePublication) => {
      const value = publication.configurations[name];
      return value === undefined ? undefined : immutable(structuredClone(value));
    },
  };
}

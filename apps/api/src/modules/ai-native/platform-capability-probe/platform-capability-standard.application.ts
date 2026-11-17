/** Standard platform probe host. Server configuration selects the original
 * profile/scene, never a request field. Disabling new work keeps authorized
 * original cancellation, recovery and accounting, but cannot send a probe. */
import { z } from 'zod';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { PlatformCapabilityProbeRequestFactory, type PlatformCapabilityProbeRequestDependencies } from './platform-capability-probe-request.factory';

export const AI_NATIVE_PLATFORM_PROBE_CONFIGURATION = Symbol('AI_NATIVE_PLATFORM_PROBE_CONFIGURATION');
export const AI_NATIVE_PLATFORM_PROBE_AUDIT = Symbol('AI_NATIVE_PLATFORM_PROBE_AUDIT');
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const configurationSchema = z.object({ enabled: z.boolean(), platformProfileId: id.max(36),
  sceneVersion: id.max(64), priceVersion: id.max(64),
  host: z.object({ holderId: id.max(191), leaseMs: z.number().int().min(1).max(120000) }).strict()
}).strict();
const unavailable = (): never => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };

export function composeStandardPlatformProbe(
  input: Pick<PlatformCapabilityProbeRequestDependencies, 'db' | 'guard' | 'secrets' | 'clock' | 'audit' | 'capacity'>,
  value?: unknown
): Pick<PlatformCapabilityProbeRequestFactory, 'open'> {
  if (value === undefined) return Object.freeze({ open: unavailable });
  let configuration: z.infer<typeof configurationSchema>;
  try { configuration = configurationSchema.parse(structuredClone(value)); }
  catch { return unavailable(); }
  const { enabled, ...settings } = configuration;
  // Without an explicit server sink, the request composition binds the original
  // task and SAME accounting facts to PrismaPlatformGatewayAudit. Its journal
  // tenant comes only from the persisted current SaaS user; call attribution
  // stays platform/null. Check storage methods without reading or seeding it.
  if (enabled && (input.audit !== undefined ? typeof input.audit?.append !== 'function'
    : typeof input.db?.$transaction !== 'function' || typeof input.db.user?.findUnique !== 'function'
      || typeof input.db.operationLog?.create !== 'function' || typeof input.db.operationLog.findUnique !== 'function')) return unavailable();
  const factory = new PlatformCapabilityProbeRequestFactory({ ...input, ...settings,
    ...(!enabled ? { protocol: { post: async () => { throw new ModelGatewayError('DISABLED'); } } } : {}) });
  return Object.freeze({ open: request => {
    const current = factory.open(request);
    if (enabled) return current;
    return Object.freeze({ ...current, prepareOriginal: unavailable, createTask: unavailable,
      readExecutableOriginal: unavailable, start: unavailable, readCapabilityReceipt: unavailable });
  } });
}

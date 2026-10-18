/** Standard staff-media assembly over the original attachment, task, Gateway
 * and ledger. Inert until explicit SERVER configuration plus current persisted
 * policies/capabilities/entitlement/budget; never an inspection submitter. */
import { z } from 'zod';
import type { ModuleRef } from '@nestjs/core';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { PrismaService } from '../../database/prisma.service';
import type { SubscriptionService } from '../../subscription/subscription.service';
import type { SecretBox } from '../../../common/secret-box';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { ModelAdapter } from '../model-gateway.ports';
import { RentalCoreController } from '../../rental-core/rental-core.controller';
import { RentalIdempotencyRepository } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { InspectionRecognitionTaskApplication, type InspectionRecognitionTaskDependencies } from './inspection-recognition-task.application';
import { StaffInspectionRequestFactory } from './inspection-assist.composition';
import { composeStaffInspectionTaskReceiptReader } from '../staff-inspection-task-receipt.composition';
import { composeStaffInspectionTaskPolicies } from '../staff-inspection-task-policy.composition';

export const AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION = Symbol('AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION');
export const AI_NATIVE_STAFF_RECOGNITION_RUNTIME = Symbol('AI_NATIVE_STAFF_RECOGNITION_RUNTIME');
/** Optional server adapter injection for a controlled transport; never body,
 * environment credentials or a second runtime. Default is the native adapter. */
export const AI_NATIVE_STAFF_RECOGNITION_ADAPTERS = Symbol('AI_NATIVE_STAFF_RECOGNITION_ADAPTERS');
export const STAFF_RECOGNITION_SCENES = Object.freeze({ image: 'staff_inspection_image', audio: 'staff_inspection_audio' } as const);
const model = z.object({ platformProfileId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  callPriceVersion: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  maxOutputTokens: z.number().int().min(1).max(32768) }).strict();
const configuration = z.discriminatedUnion('enabled', [z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), image: model, audio: model.optional(), limits: aiTaskRunnerLimitsSchema,
    host: z.object({ holderId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
      leaseMs: z.number().int().min(1).max(120000) }).strict() }).strict()]);
export function readStaffRecognitionConfiguration(value?: unknown) {
  try {
    const parsed = configuration.safeParse(structuredClone(value ?? { enabled: false }));
    if (parsed.success) return parsed.data;
  } catch { /* Server data, not live objects/functions or caller configuration. */ }
  throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
}
type Dependencies = { db: PrismaService; auth: AuthService; guard: ApiAuthGuard; core: RentalCoreService;
  subscriptions: SubscriptionService; secrets: SecretBox; files: FileStorageRuntimeService; moduleRef: ModuleRef;
  adapters?: readonly ModelAdapter[]; clock?: () => Date };
export function composeStandardStaffRecognition(d: Dependencies, value?: unknown) {
  const selected = readStaffRecognitionConfiguration(value);
  const inspection = { db: d.db, guard: d.guard, core: d.core, storage: d.files,
    originalInspection: { controller: { createInspection: (...args: Parameters<RentalCoreController['createInspection']>) =>
      d.moduleRef.get(RentalCoreController, { strict: false }).createInspection(...args) }, receipts: new RentalIdempotencyRepository(d.db) } };
  const receipts = composeStaffInspectionTaskReceiptReader({ db: d.db, auth: d.auth, inspection, clock: d.clock }, { enabled: true,
    scenes: [{ kind: 'image', code: STAFF_RECOGNITION_SCENES.image, version: '1' },
      { kind: 'audio', code: STAFF_RECOGNITION_SCENES.audio, version: '1' }] });
  const absent = async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
  if (!selected.enabled) return { enabled: false as const, staffRequests: new StaffInspectionRequestFactory(inspection),
    application: { create: absent, readCreation: receipts.readCreation.bind(receipts), start: absent, reconcile: absent,
      readResultReview: absent, saveResultReview: absent, readInput: absent, resume: absent, readAnswer: absent,
      continueAnswer: absent, requestCancel: absent }, policies: { read: absent, configure: absent, clear: absent } };
  const select = (kind: 'image' | 'audio', config: z.infer<typeof model>) => ({ db: d.db, auth: d.auth, guard: d.guard,
    subscriptions: d.subscriptions, clock: d.clock, host: structuredClone(selected.host),
    scene: { code: STAFF_RECOGNITION_SCENES[kind], version: '1' },
    gatewayScene: { sceneCode: STAFF_RECOGNITION_SCENES[kind], routeScene: 'vision' as const, maxOutputTokens: config.maxOutputTokens },
    gateway: { secrets: d.secrets, platformProfileId: config.platformProfileId, callPriceVersion: config.callPriceVersion,
      routeScene: 'vision' as const, ...(d.adapters ? { adapters: [...d.adapters] } : { nativeProtocol: 'openai_chat_completions' as const }) } });
  const dependencies: InspectionRecognitionTaskDependencies = { enabled: true, inspection, limits: selected.limits,
    model: select('image', selected.image), ...(selected.audio ? { audioModel: select('audio', selected.audio) } : {}) };
  const application = new InspectionRecognitionTaskApplication(dependencies);
  return { enabled: true as const, staffRequests: new StaffInspectionRequestFactory(inspection),
    application: { create: application.create.bind(application), readCreation: receipts.readCreation.bind(receipts),
      start: application.start.bind(application), reconcile: application.reconcile.bind(application),
      readResultReview: application.readResultReview.bind(application), saveResultReview: application.saveResultReview.bind(application),
      readInput: application.readInput.bind(application), resume: application.resume.bind(application),
      readAnswer: application.readAnswer.bind(application), continueAnswer: application.continueAnswer.bind(application),
      requestCancel: application.requestCancel.bind(application) },
    policies: composeStaffInspectionTaskPolicies(dependencies, { enabled: true, ttlMs: 120000,
      operations: ['read_metadata', 'read_events', 'read_step_terminal', 'claim_run', 'claim_recovery_run', 'release_run',
        'transition_task', 'takeover_run', 'request_input', 'submit_input', 'resume_input'] }) };
}

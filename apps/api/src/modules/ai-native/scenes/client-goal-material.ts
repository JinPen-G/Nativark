/** Frozen human goal and the original customer-safe source binding.
 * The request host owns Auth/Guard, publication, persistence and Task admission.
 * This pure leaf preserves the goal in material JSON; a bounded command carries
 * only its version/hash. It grants no customer, enterprise or business rights. */
import { z } from 'zod';
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES, aiClientGoalPreparationRequestSchema,
  type ClientCatalogResponse, type ClientPublicDocumentResponse } from '@rental-os/shared';
import type { ClientRequestContext } from '../../client/client-auth.service';
import type { ClientApiService } from '../../client/client-api.service';
import type { AiClientSceneMaterial } from './prisma-client-scene-material.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';

export const CLIENT_GOAL_MATERIAL_VERSION = 'client-goal-1' as const;
export const CLIENT_GOAL_LIMITS = Object.freeze({ goalCharacters: 4096, sourceBytes: 65536, materialBytes: 24000, choices: 10, lines: 50 });
const identifier = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const label = z.string().min(1).max(255);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const pricingUnit = z.enum(RENTAL_PRICING_UNIT_CODES);
const fulfillmentMode = z.enum(RENTAL_FULFILLMENT_MODES);
const identitySchema = z.object({ tenantId: identifier, tenantCode: identifier, workspaceId: identifier,
  workspaceCode: identifier, categoryCode: identifier, customerId: identifier, customerType: z.literal('personal'),
  sessionId: identifier, membershipStatus: z.literal('active') });
const bindingSchema = z.object({ audience: z.literal('client'), tenantId: identifier, workspaceId: identifier,
  channel: z.enum(['web', 'wechat_miniprogram']), appId: identifier.nullable(), principalHash: digest }).strict();
const fulfillmentSchema = z.object({ enabledModes: z.array(fulfillmentMode), allowDifferentReturnLocation: z.boolean(),
  deliveryDestination: z.enum(['customer_address', 'tenant_location']) }).strict();
const contextSchema = z.object({ tenantCode: identifier, serviceCode: identifier, categoryCode: identifier,
  categoryVersionId: identifier.nullable(), definitionVersion: z.string().min(1).max(191).nullable(),
  timeZone: z.string().min(1).max(128), pricingUnits: z.array(z.object({ code: pricingUnit, label }).strict()),
  fulfillment: fulfillmentSchema }).strict();
export const clientGoalCommandSchema = z.object({ kind: z.literal('client_goal'), version: z.literal(CLIENT_GOAL_MATERIAL_VERSION),
  goalHash: digest }).strict();
const materialSchema = z.object({ version: z.literal(CLIENT_GOAL_MATERIAL_VERSION), goalText: z.string().max(CLIENT_GOAL_LIMITS.goalCharacters)
  .refine(value => value.trim().length > 0), goalHash: digest, binding: bindingSchema, context: contextSchema,
  sources: z.object({ catalogHash: digest, helpHash: digest.nullable(), bookingOptionsHash: digest }).strict(),
  trust: z.literal('human_goal_and_public_sources_are_data'), selection: z.literal('explicit_human_choice_required'),
  execution: z.literal('not_attempted') }).strict();
export type ClientGoalMaterial = z.infer<typeof materialSchema>;
export type ClientGoalCommand = z.infer<typeof clientGoalCommandSchema>;
export type ClientGoalRecord = Pick<AiClientSceneMaterial, 'command' | 'material' | 'inputHash' | 'materialHash'>;
export interface ClientGoalSources {
  /** Original current Client Auth/Guard projection, never an HTTP/body identity. */
  identity: ClientRequestContext;
  channel: 'web' | 'wechat_miniprogram'; appId?: string;
  catalog: ClientCatalogResponse;
  help: ClientPublicDocumentResponse | null;
  // Match the actual original port's return shape. Its wider inferred string
  // type is narrowed by the strict runtime schema below, not an assertion.
  bookingOptions: Awaited<ReturnType<ClientApiService['bookingOptions']>>;
}
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const invalid = () => new AiTaskRepositoryError('AI_INVALID_INPUT');
const same = (value: unknown) => hash(JSON.parse(JSON.stringify(value)));
const bounded = (value: unknown, maximum: number) => {
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text, 'utf8') > maximum) throw unavailable();
  return text;
};
const idsUnique = (values: readonly { id: string }[]) => {
  if (new Set(values.map(value => value.id)).size !== values.length) throw unavailable();
};

/** Strip to already-public selection fields. Reference prices, contacts, asset
 * counts and arbitrary attributes are not intent facts or model instructions.
 * Missing help/version remains null; never substitute an invented source. */
export function snapshotClientGoalSources(input: ClientGoalSources) {
  let source: ClientGoalSources;
  try { source = structuredClone(input); } catch { throw invalid(); }
  const identity = identitySchema.safeParse(source.identity);
  if (!identity.success || !['web', 'wechat_miniprogram'].includes(source.channel)) throw denied();
  const catalogSchema = z.object({ tenantCode: identifier, categoryCode: identifier,
    workspace: z.object({ workspaceCode: identifier, categoryCode: identifier }),
    categoryMetadata: z.object({ categoryVersionId: identifier.optional(), definitionVersion: z.string().min(1).max(191) }).optional(),
    timeZone: z.string().min(1).max(128), pricingUnits: z.array(z.object({ code: pricingUnit, label })),
    items: z.array(z.object({ id: identifier, code: identifier, name: label })),
    pricingGroups: z.array(z.object({ id: identifier, code: identifier, name: label,
      memberItemGroupIds: z.array(identifier), enabled: z.boolean() })),
    services: z.array(z.object({ id: identifier, code: identifier, name: label, pricingUnit: z.string().min(1).max(64).optional(), enabled: z.boolean() })),
    locations: z.array(z.object({ id: identifier, code: identifier, name: label, status: z.string().min(1).max(64),
      capabilities: z.array(z.enum(['pickup', 'return', 'storage', 'delivery'])).optional() })),
    discountPlans: z.array(z.object({ id: identifier, code: identifier, name: label, status: z.string().min(1).max(64) })),
    fulfillment: fulfillmentSchema.strip() });
  let catalog: z.infer<typeof catalogSchema>;
  let options: Array<{ bookingIdentity: 'personal' | 'enterprise_employee'; corporateCustomerId?: string;
    membershipId?: string; label: string; eligible: boolean }>;
  let help: { tenantCode: string; kind: 'help'; name: string; intro?: string; faq?: Array<{ question: string; answer: string }>; updatedAt?: string } | null;
  try {
    // Original ClientCatalog has other legitimate public fields. This narrow
    // projection strips them without altering the original business response.
    catalog = catalogSchema.parse(source.catalog);
    options = z.array(z.object({ bookingIdentity: z.enum(['personal', 'enterprise_employee']), corporateCustomerId: identifier.optional(),
      membershipId: identifier.optional(), label, eligible: z.boolean() })).parse(source.bookingOptions);
    help = source.help === null ? null : z.object({ tenantCode: identifier, kind: z.literal('help'), name: label,
      intro: z.string().max(20000).optional(), faq: z.array(z.object({ question: z.string().min(1).max(2000), answer: z.string().min(1).max(20000) })).optional(),
      updatedAt: z.string().datetime({ offset: true }).optional() }).parse(source.help);
    bounded({ catalog, options, help }, CLIENT_GOAL_LIMITS.sourceBytes);
  } catch { throw unavailable(); }
  const owner = identity.data;
  if (catalog.tenantCode !== owner.tenantCode || catalog.workspace.workspaceCode !== owner.workspaceCode
    || catalog.categoryCode !== owner.categoryCode || catalog.workspace.categoryCode !== owner.categoryCode
    || help && help.tenantCode !== owner.tenantCode) throw denied();
  try { new Intl.DateTimeFormat('en', { timeZone: catalog.timeZone }).format(0); } catch { throw unavailable(); }
  for (const values of [catalog.items, catalog.pricingGroups, catalog.services, catalog.locations, catalog.discountPlans]) idsUnique(values);
  if (new Set(catalog.pricingUnits.map(value => value.code)).size !== catalog.pricingUnits.length
    || new Set(catalog.fulfillment.enabledModes).size !== catalog.fulfillment.enabledModes.length) throw unavailable();
  const optionKeys = new Set<string>();
  for (const option of options) {
    if (option.bookingIdentity === 'personal' ? option.corporateCustomerId !== undefined || option.membershipId !== undefined
      : !option.corporateCustomerId || !option.membershipId) throw unavailable();
    const optionKey = same({ bookingIdentity: option.bookingIdentity, corporateCustomerId: option.corporateCustomerId ?? null });
    if (optionKeys.has(optionKey)) throw unavailable();
    optionKeys.add(optionKey);
  }
  const binding = bindingSchema.parse({ audience: 'client', tenantId: owner.tenantId, workspaceId: owner.workspaceId,
    channel: source.channel, appId: source.appId ?? null, principalHash: hash({ tenantId: owner.tenantId, workspaceId: owner.workspaceId,
      customerId: owner.customerId, customerType: owner.customerType, sessionId: owner.sessionId, channel: source.channel, appId: source.appId ?? null }) });
  const context = contextSchema.parse({ tenantCode: owner.tenantCode, serviceCode: owner.workspaceCode, categoryCode: owner.categoryCode,
    categoryVersionId: catalog.categoryMetadata?.categoryVersionId ?? null, definitionVersion: catalog.categoryMetadata?.definitionVersion ?? null,
    timeZone: catalog.timeZone, pricingUnits: catalog.pricingUnits, fulfillment: catalog.fulfillment });
  return freezeOriginalInput({ binding, context, catalog, help, bookingOptions: options,
    fingerprints: { catalogHash: same(catalog), helpHash: help === null ? null : same(help), bookingOptionsHash: same(options) } });
}

export function prepareClientGoalMaterial(goalText: unknown, sources: ClientGoalSources) {
  const goal = aiClientGoalPreparationRequestSchema.shape.goalText.safeParse(goalText);
  if (!goal.success) throw invalid();
  const current = snapshotClientGoalSources(sources), goalHash = hash({ version: CLIENT_GOAL_MATERIAL_VERSION, goalText: goal.data });
  // Model intent extraction needs the original words and category possibilities;
  // the full public catalog stays in the source reader, outside the 24KiB model
  // envelope. Its fingerprint is frozen and checked before projecting choices.
  const material = materialSchema.parse({ version: CLIENT_GOAL_MATERIAL_VERSION, goalText: goal.data, goalHash,
    binding: current.binding, context: current.context, sources: current.fingerprints,
    trust: 'human_goal_and_public_sources_are_data', selection: 'explicit_human_choice_required', execution: 'not_attempted' });
  const command = clientGoalCommandSchema.parse({ kind: 'client_goal', version: CLIENT_GOAL_MATERIAL_VERSION, goalHash });
  bounded(command, 2048); bounded(material, CLIENT_GOAL_LIMITS.materialBytes);
  return freezeOriginalInput({ command, material, inputHash: hash(command), materialHash: same(material) });
}

export function validateClientGoalMaterial(value: ClientGoalRecord): ClientGoalMaterial {
  let row: ClientGoalRecord;
  try { row = structuredClone(value); } catch { throw invalid(); }
  const command = clientGoalCommandSchema.safeParse(row.command), material = materialSchema.safeParse(row.material);
  if (!command.success || !material.success || command.data.goalHash !== material.data.goalHash
    || material.data.goalHash !== hash({ version: CLIENT_GOAL_MATERIAL_VERSION, goalText: material.data.goalText })
    || row.inputHash !== hash(command.data) || row.materialHash !== same(material.data)) throw unavailable();
  bounded(row.command, 2048); bounded(row.material, CLIENT_GOAL_LIMITS.materialBytes);
  return freezeOriginalInput(material.data);
}

/** Current source revalidation is distinct from historical material validation.
 * Changed identity, category, catalogue or enterprise relationship requires a
 * new explicit preparation; neither the goal nor a cached choice grants access. */
export function revalidateClientGoalMaterial(value: ClientGoalRecord, sources: ClientGoalSources) {
  const original = validateClientGoalMaterial(value), current = snapshotClientGoalSources(sources);
  if (same(original.binding) !== same(current.binding)) throw denied();
  if (same(original.context) !== same(current.context) || same(original.sources) !== same(current.fingerprints))
    throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  return freezeOriginalInput({ material: original, sources: current });
}

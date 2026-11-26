/** Original Task ownership predicate, without lifecycle, dispatch or persistence. */
import type { Prisma, AiActorKind, AiAudience } from '@prisma/client';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiTaskRepositoryError } from '../task-errors';
import { aiPersistenceScopeColumns } from './persistence-scope';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const actorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: id }).strict(),
  z.object({ kind: z.literal("saas_admin"), userId: id }).strict(),
  z.object({ kind: z.literal("customer"), customerId: id }).strict(),
  z.object({ kind: z.literal("automation"), subjectId: id, policyId: id, policyRevision: revision, expiresAt: z.string().datetime({ offset: true }) }).strict()
]);
const identitySchema = z.object({
  contractVersion: z.literal(AI_CONTRACT_DRAFT_VERSION), requestId: id,
  authorizedAt: z.string().datetime({ offset: true }),
  audience: z.enum(["operator", "staff", "client", "automation"]), actor: actorSchema
});
/** Validate a context already resolved by a required authority; this helper grants no permission. */
export function aiTaskAccessFromContext(context: AiExecutionContext, taskId: string, now: Date) {
  if (!id.safeParse(taskId).success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
  const parsed = identitySchema.safeParse(context);
  if (!parsed.success) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
  let scope;
  try { scope = aiPersistenceScopeColumns(context.scope); }
  catch { throw new AiTaskRepositoryError("AI_ACCESS_DENIED"); }
  const actor = parsed.data.actor, audience = parsed.data.audience;
  const allowedShape = actor.kind === "saas_admin" ? audience === "operator" && scope.kind === "PLATFORM"
    : scope.kind !== "PLATFORM" && (actor.kind === "user" ? audience === "operator" || audience === "staff"
      : actor.kind === "customer" ? audience === "client" : audience === "automation");
  if (!allowedShape || !(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(parsed.data.authorizedAt) > now.getTime()
    || (actor.kind === "automation" && Date.parse(actor.expiresAt) <= now.getTime())) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
  const ownerKind = actor.kind.toUpperCase() as AiActorKind;
  const ownerId = actor.kind === "customer" ? actor.customerId : actor.kind === "automation" ? actor.subjectId : actor.userId;
  const where: Prisma.AiTaskWhereInput = {
    id: taskId, archivedAt: null, scopeKind: scope.kind, scope: { is: scope },
    audience: audience.toUpperCase() as AiAudience, ownerKind, ownerId,
    ...(actor.kind === "automation" ? { policyId: actor.policyId, policyRevision: actor.policyRevision, policyExpiresAt: { gt: now } } : {})
  };
  // The original tuple is persisted in creation fingerprints; changing it would
  // orphan valid old receipts. It is NOT a current authorization revision.
  const ownershipBindingKey = JSON.stringify([scope, audience, ownerKind, ownerId,
    actor.kind === "automation" ? [actor.policyId, actor.policyRevision, actor.expiresAt] : null]);
  // All existing before/after delivery and recovery checks also bind the current
  // permission/data/location/organization projection. Correlation time is not
  // authority, and this hash never grants access or replaces the required source.
  const bindingKey = requestFingerprint({ ownershipBindingKey,
    ...("access" in context ? { access: context.access }
      : "permissions" in context ? { permissions: context.permissions } : {}) });
  return { where, now, actorKind: ownerKind, actorId: ownerId, authorizedAt: new Date(parsed.data.authorizedAt),
    bindingKey, ownershipBindingKey, scope, audience: audience.toUpperCase() as AiAudience, actor, requestId: parsed.data.requestId };
}

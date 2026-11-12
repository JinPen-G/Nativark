/** Core's server-only single-submission delegation port and sealed authority.
 * The host supplies the existing private enterprise source owner, never an HTTP
 * descriptor/callback. Core retains operator ALS and delegates business decisions
 * to the original order creation; recovery never performs a new preparation. */
import { ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import type { CreateRentalOrderRequest, SystemUserRow } from "@rental-os/shared";
import { getRequestIdentity, requireRequestTenantId, requireRequestUserId, requireRequestWorkspaceId } from "../../common/request-identity";
import type { BusinessContext } from "./rental-business.service";
import { requestFingerprint } from "./rental-idempotency.repository";
import type { RentalOrderConfirmationService } from "./rental-order-confirmation.service";
import type { ApprovedOrderBinding, ApprovedOrderMerchantDelegation, ApprovedOrderTransaction } from "./approved-order-transaction.ports";

type ActorAuth = { authorization?: string; user: SystemUserRow };
type Reference = { delegationKey: string; expectedRevision: number; approvalId?: string };
type SourceOwner = {
  readMerchantDelegatedSubmission(actor: ActorAuth, reference: Reference): Promise<unknown>;
  prepareMerchantDelegatedSubmission?(actor: ActorAuth, reference: Reference): Promise<unknown>;
  merchantDelegationParticipant(actor: ActorAuth, reference: Reference): ApprovedOrderTransaction;
};
type SourceState = "issued" | "consumed" | "revoked";
type Descriptor = {
  proof: Readonly<ApprovedOrderMerchantDelegation>;
  tenantId: string;
  workspaceId: string;
  request: CreateRentalOrderRequest;
  state: SourceState;
  stateRevision: number;
  expiresAt: string;
  approvalId?: string;
};
export interface MerchantDelegatedOrderAuthority { readonly kind: "core_merchant_delegated_order" }
interface SealedAuthority {
  source: Readonly<Descriptor>;
  participant: ApprovedOrderTransaction;
  mode: "execute" | "original";
  identityHash: string;
  methods: Readonly<ApprovedOrderTransaction>;
}
const sealed = new WeakMap<MerchantDelegatedOrderAuthority, Readonly<SealedAuthority>>();
const verifiedProofs = new WeakMap<Readonly<ApprovedOrderMerchantDelegation>, Readonly<SealedAuthority>>();
const verifiedBindings = new WeakMap<Readonly<ApprovedOrderBinding>, Readonly<SealedAuthority>>();
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

function actorScope(actor: ActorAuth) {
  const identity = getRequestIdentity(), tenantId = requireRequestTenantId(), workspaceId = requireRequestWorkspaceId(), userId = requireRequestUserId();
  if (!identity || identity.audience !== "operator" || identity.isSaasAdmin || identity.staffApi
    || !actor.user?.isActive || actor.user.isSaasAdmin || actor.user.id !== userId || actor.user.tenantId !== tenantId) {
    throw new ForbiddenException("商户委托须使用当前原营运身份");
  }
  return { tenantId, workspaceId, userId, identityHash: requestFingerprint(identity) };
}

/** Only the private source-owner read can reach this mint. Its own Auth/source
 * integrity checks remain required; these checks bind that result to Core's K,
 * request and current operator, without inventing another public source DTO. */
function descriptor(value: unknown, actor: ActorAuth, reference: Reference,
  fingerprint: (request: CreateRentalOrderRequest) => string, prepared = false): Descriptor {
  const scope = actorScope(actor), row = value as Record<string, unknown> | null;
  if (!row || typeof row !== "object" || Array.isArray(row) || row.version !== "enterprise-order-delegation-1"
    || row.purpose !== "merchant_operator" || typeof reference.delegationKey !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(reference.delegationKey)
    || reference.expectedRevision !== 1 || !prepared && row.issuedRevision !== reference.expectedRevision
    || prepared && row.issuedRevision !== undefined && row.issuedRevision !== reference.expectedRevision
    || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
    || row.delegationKey !== reference.delegationKey || row.coreIdempotencyKey !== reference.delegationKey
    || !id(row.personalCustomerId) || !id(row.corporateCustomerId) || !id(row.quoteId)
    || !hash(row.sourceHash) || !hash(row.basisHash) || !hash(row.requestHash)
    || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))
    || !Number.isSafeInteger(row.revision) || (row.revision as number) < reference.expectedRevision
    || reference.approvalId !== undefined && row.approvalId !== reference.approvalId) {
    throw new ConflictException("原商户委托源版本、范围或D/K关联不可核对");
  }
  const request = row.request as CreateRentalOrderRequest | undefined;
  if (!request || typeof request !== "object" || Array.isArray(request) || request.customerType !== "personal"
    || request.customerId !== row.personalCustomerId || request.quoteId !== row.quoteId || fingerprint(request) !== row.requestHash) {
    throw new ConflictException("原商户委托请求或使用人关联不可核对");
  }
  const state = prepared ? "issued" : row.state;
  if (!["issued", "consumed", "revoked"].includes(state as string)
    || prepared && (row.revision !== reference.expectedRevision || Date.parse(row.expiresAt) <= Date.now())) {
    throw new ConflictException("原商户委托不能新提交，请核对原结果");
  }
  return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, request: structuredClone(request),
    state: state as SourceState, stateRevision: row.revision as number, expiresAt: row.expiresAt,
    approvalId: typeof row.approvalId === "string" ? row.approvalId : undefined,
    proof: Object.freeze({ version: "enterprise-order-delegation-1", purpose: "merchant_operator",
      delegationKey: reference.delegationKey, sourceHash: row.sourceHash, basisHash: row.basisHash,
      requestHash: row.requestHash, quoteId: row.quoteId, expectedRevision: reference.expectedRevision,
      personalCustomerId: row.personalCustomerId, corporateCustomerId: row.corporateCustomerId, actorUserId: scope.userId }) as ApprovedOrderMerchantDelegation };
}

function mint(source: Descriptor, participant: ApprovedOrderTransaction, mode: SealedAuthority["mode"], identityHash: string) {
  if (!participant || [participant.authorize, participant.recover, participant.prepare, participant.commit, participant.replay]
    .some(method => typeof method !== "function")) throw new ServiceUnavailableException("原商户委托参加者不可用");
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(source.request);
  const authority: MerchantDelegatedOrderAuthority = Object.freeze({ kind: "core_merchant_delegated_order" });
  const methods = Object.freeze({ authorize: participant.authorize, recover: participant.recover,
    prepare: participant.prepare, commit: participant.commit, replay: participant.replay });
  const value = Object.freeze({ source: Object.freeze(source), participant, mode, identityHash, methods });
  sealed.set(authority, value);
  verifiedProofs.set(source.proof, value);
  return authority;
}

/** A same-shaped body or replacement callback is not a Core authority. */
export function assertMerchantDelegatedOrderAuthority(authority: MerchantDelegatedOrderAuthority,
  tenantId: string, workspaceId: string, key: string, fingerprint: string, participant?: ApprovedOrderTransaction) {
  const value = sealed.get(authority), identity = getRequestIdentity();
  if (!value || !identity || identity.audience !== "operator" || identity.isSaasAdmin || identity.staffApi
    || requireRequestTenantId() !== tenantId || requireRequestWorkspaceId() !== workspaceId
    || requireRequestUserId() !== value.source.proof.actorUserId || requestFingerprint(identity) !== value.identityHash
    || value.source.tenantId !== tenantId || value.source.workspaceId !== workspaceId
    || value.source.proof.delegationKey !== key || value.source.proof.requestHash !== fingerprint
    || participant !== undefined && participant !== value.participant
    || (Object.keys(value.methods) as Array<keyof ApprovedOrderTransaction>).some(key => value.participant[key] !== value.methods[key])) {
    throw new ForbiddenException("商户委托须使用原身份、源及同一封存参加者");
  }
  return value;
}

/** Only Core's original entry may register a binding against an opaque source
 * authority. This does not mint an authority or accept a callback as evidence. */
export function bindCoreMerchantDelegationProof(authority: MerchantDelegatedOrderAuthority, binding: ApprovedOrderBinding) {
  const value = assertMerchantDelegatedOrderAuthority(authority, binding.tenantId, binding.workspaceId,
    binding.idempotencyKey, binding.requestFingerprint);
  if (binding.merchantDelegation !== value.source.proof || binding.request.customerId !== value.source.proof.personalCustomerId
    || binding.request.quoteId !== value.source.proof.quoteId) throw new ForbiddenException("原Core委托binding与来源不一致");
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(binding.request);
  Object.freeze(binding);
  verifiedBindings.set(binding, value);
}

/** Policy consumes the original Core proof object, never the JSON projection
 * delivered to a participant or HTTP. Matching fields alone are insufficient. */
export function assertCoreMerchantDelegationProof(proof: Readonly<ApprovedOrderMerchantDelegation>, binding: Readonly<ApprovedOrderBinding>) {
  const value = verifiedProofs.get(proof), identity = getRequestIdentity();
  if (!value || !identity || identity.audience !== "operator" || identity.isSaasAdmin || identity.staffApi
    || verifiedBindings.get(binding) !== value || binding.merchantDelegation !== proof || requireRequestTenantId() !== binding.tenantId
    || requireRequestWorkspaceId() !== binding.workspaceId || requireRequestUserId() !== proof.actorUserId
    || requestFingerprint(identity) !== value.identityHash || value.source.tenantId !== binding.tenantId
    || value.source.workspaceId !== binding.workspaceId || binding.idempotencyKey !== proof.delegationKey
    || binding.requestFingerprint !== proof.requestHash || binding.request.quoteId !== proof.quoteId
    || binding.request.customerId !== proof.personalCustomerId || value.source.proof !== proof
    || (Object.keys(value.methods) as Array<keyof ApprovedOrderTransaction>).some(key => value.participant[key] !== value.methods[key])) {
    throw new ForbiddenException("商户委托须使用Core原封存来源证明");
  }
  return proof;
}

/** Host-only composition around the existing private source owner. Neither
 * execution nor original reads accept a client-provided source/participant. */
export class RentalMerchantDelegatedOrderPort {
  constructor(private readonly orders: Pick<RentalOrderConfirmationService, "fingerprintOrderRequest" | "createApprovedOrder" | "readOrderCreation">,
    private readonly sources: SourceOwner) {}

  private async read(actor: ActorAuth, reference: Reference) {
    if (!this.sources || typeof this.sources.readMerchantDelegatedSubmission !== "function"
      || typeof this.sources.merchantDelegationParticipant !== "function") throw new ServiceUnavailableException("原商户委托私有来源未装配");
    const before = actorScope(actor);
    const source = descriptor(await this.sources.readMerchantDelegatedSubmission(actor, reference), actor, reference,
      request => this.orders.fingerprintOrderRequest(request));
    if (actorScope(actor).identityHash !== before.identityHash) throw new ForbiddenException("读取商户委托时原身份已变化");
    return { source, participant: this.sources.merchantDelegationParticipant(actor, reference), identityHash: before.identityHash };
  }

  async execute(actor: ActorAuth, reference: Reference, userName: string, context: BusinessContext) {
    actor = structuredClone(actor); reference = structuredClone(reference);
    const value = await this.read(actor, reference);
    let source = value.source, mode: SealedAuthority["mode"] = "original";
    if (source.state === "issued" && Date.parse(source.expiresAt) > Date.now()) {
      if (typeof this.sources.prepareMerchantDelegatedSubmission !== "function") throw new ServiceUnavailableException("原商户委托新提交准备未装配");
      // The fixed owner intentionally omits state/issuedRevision from prepare.
      // Keep the issuing revision from private read and compare its immutable
      // facts with the owner's strictly issued preparation result.
      const prepared = descriptor(await this.sources.prepareMerchantDelegatedSubmission(actor, reference), actor, reference,
        request => this.orders.fingerprintOrderRequest(request), true);
      if (requestFingerprint(prepared.proof) !== requestFingerprint(source.proof)
        || requestFingerprint(prepared.request) !== requestFingerprint(source.request) || prepared.expiresAt !== source.expiresAt) {
        throw new ConflictException("原商户委托在准备期间已变化");
      }
      source = prepared; mode = "execute";
    }
    const authority = mint(source, value.participant, mode, value.identityHash);
    return this.orders.createApprovedOrder(source.tenantId, source.request, userName, context,
      source.proof.delegationKey, value.participant, authority);
  }

  async readOriginal(actor: ActorAuth, reference: Reference) {
    actor = structuredClone(actor); reference = structuredClone(reference);
    const value = await this.read(actor, reference);
    const authority = mint(value.source, value.participant, "original", value.identityHash);
    const result = await this.orders.readOrderCreation(value.source.tenantId, value.source.request, value.source.proof.delegationKey, undefined, authority);
    const latest = descriptor(await this.sources.readMerchantDelegatedSubmission(actor, reference), actor, reference,
      request => this.orders.fingerprintOrderRequest(request));
    if (requestFingerprint(latest.proof) !== requestFingerprint(value.source.proof)
      || latest.state !== value.source.state || latest.stateRevision !== value.source.stateRevision) {
      throw new ConflictException("原商户委托在结果读取期间已变化");
    }
    return result;
  }
}

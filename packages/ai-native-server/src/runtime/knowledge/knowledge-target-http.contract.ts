/** Closed transport contracts for original prepared-upload targets and current
 * policy metadata. Validation never creates policy, upload or execution rights. */
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS, AI_KNOWLEDGE_POLICY_MANAGEMENT_HTTP_SCHEMAS,
  AI_KNOWLEDGE_TARGET_HTTP_CONTRACTS, type AiKnowledgeTargetResponseDraft, type AiKnowledgePolicyCurrentResponseDraft } from '@rental-os/shared';
import { KnowledgePolicyManagementError, canonicalPolicyResource, managementFingerprint as hash,
  originalResourceKey, policyKeyHash } from './knowledge-policy-management.validation';

const ajv = new Ajv({ strict: false, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv);
const refs = (value: unknown): unknown => Array.isArray(value) ? value.map(refs) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === '$ref' && typeof child === 'string'
    ? child.replace(/^#\/components\/schemas\//u, '#/$defs/') : refs(child)])) : value;
const definitions = refs({ ...AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS, ...AI_KNOWLEDGE_POLICY_MANAGEMENT_HTTP_SCHEMAS });
type Action = keyof typeof AI_KNOWLEDGE_TARGET_HTTP_CONTRACTS;
const validators = Object.fromEntries(Object.entries(AI_KNOWLEDGE_TARGET_HTTP_CONTRACTS).map(([action, contract]) => [action, {
  request: ajv.compile({ $defs: definitions, $ref: `#/$defs/${contract.request}` }),
  response: ajv.compile({ $defs: definitions, $ref: `#/$defs/${contract.response}` })
}])) as Record<Action, { request: ValidateFunction; response: ValidateFunction }>;

export function validateKnowledgeTargetRequest(action: Action, value: unknown) {
  if (!validators[action].request(value)) throw new KnowledgePolicyManagementError('invalid_input');
}
export function validateKnowledgeTargetResponse(action: Action, value: unknown, command: {
  authorityId: string; operationKey?: string; specHash?: string; sessionId?: string;
}): AiKnowledgeTargetResponseDraft | AiKnowledgePolicyCurrentResponseDraft {
  try {
    const copy = structuredClone(value);
    if (!validators[action].response(copy) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072) throw Error();
    if (action === 'read') {
      const result = copy as AiKnowledgePolicyCurrentResponseDraft, target = result.target;
      if (result.authorityId !== command.authorityId || result.policyKeyHash !== policyKeyHash(target)
        || target.resourceKey !== originalResourceKey(result.resource)
        || hash(canonicalPolicyResource(target.domain, target.action, result.resource)) !== hash(result.resource)) throw Error();
      if ('owner' in result.resource && result.resource.owner?.actorId !== target.actorId) throw Error();
    } else {
      const result = copy as AiKnowledgeTargetResponseDraft;
      if (command.operationKey !== undefined && result.operationKey !== command.operationKey
        || command.specHash !== undefined && 'specHash' in result && result.specHash !== command.specHash) throw Error();
      if (result.state === 'prepared' || result.state === 'bound') {
        if (result.specification.operationKey !== result.operationKey
          || Date.parse(result.specification.expiresAt) !== Date.parse(result.expiresAt)
          || result.specification.document.validUntil !== undefined
            && Date.parse(result.specification.document.validUntil) <= Date.parse(result.specification.document.validFrom)
          || action === 'bindTarget' && (result.state !== 'bound' || result.uploadSessionId !== command.sessionId)) throw Error();
      }
    }
    return copy as AiKnowledgeTargetResponseDraft | AiKnowledgePolicyCurrentResponseDraft;
  } catch { throw new KnowledgePolicyManagementError(AI_KNOWLEDGE_TARGET_HTTP_CONTRACTS[action].write ? 'result_unknown' : 'unavailable'); }
}

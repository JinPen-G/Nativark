/** Closed original retention responses. Date conversion mirrors JSON transport,
 * not field removal or defaulting. A malformed cleanup result is unknown; only
 * current original receipts can resolve it. This never authorizes deletion. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_RETENTION_HTTP_SCHEMAS, AI_RETENTION_HTTP_CONTRACTS,
  type AiRetentionHttpRequestsDraft, type AiRetentionHttpResponsesDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiRetentionUnknown } from './retention.service';
type Action = keyof typeof AI_RETENTION_HTTP_CONTRACTS;
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false }); addFormats(ajv);
for (const [name, schema] of Object.entries(AI_RETENTION_HTTP_SCHEMAS)) ajv.addSchema(schema, `#/components/schemas/${name}`);
function wire(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, wire(child)]));
  throw Error('Invalid retention wire value');
}
export function retentionHttpRequest<A extends Action>(action: A, value: unknown): AiRetentionHttpRequestsDraft[A] {
  try {
    const copy = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 65536
      || !ajv.getSchema(`#/components/schemas/${AI_RETENTION_HTTP_CONTRACTS[action].request}`)!(copy)) throw Error();
    return copy as AiRetentionHttpRequestsDraft[A];
  } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
}
export function retentionHttpResponse<A extends Action>(action: A, value: unknown,
  command: AiRetentionHttpRequestsDraft[A]): AiRetentionHttpResponsesDraft[A] {
  try {
    const copy = wire(structuredClone(value)) as AiRetentionHttpResponsesDraft[Action];
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072
      || !ajv.getSchema(`#/components/schemas/${AI_RETENTION_HTTP_CONTRACTS[action].response}`)!(copy)) throw Error();
    if ('id' in copy && (!('id' in command) || copy.id !== command.id)) throw Error();
    if ('results' in copy && (copy.limit !== ('limit' in command ? command.limit ?? 5 : 5)
      || copy.scanned > copy.limit || copy.results.length !== copy.scanned)) throw Error();
    if ('rows' in copy && copy.rows.length > ('limit' in command ? command.limit ?? 20 : 20)) throw Error();
    return copy as AiRetentionHttpResponsesDraft[A];
  } catch {
    if (AI_RETENTION_HTTP_CONTRACTS[action].write) throw new AiRetentionUnknown();
    throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  }
}

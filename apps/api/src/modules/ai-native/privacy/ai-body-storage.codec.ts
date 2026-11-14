/** AI私有正文的存储封装。复用原SecretBox和密钥轮换，绑定原行与列；
 * 不产生授权、不改内容哈希，也不保存检索明文副本。旧明文只兼容读取，
 * 回填须走独立受权维护；损坏密文和缺密钥不能降级为明文或空成功。 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { SECRET_BOX_ENVELOPE_PATTERN, type SecretBox } from '../../../common/secret-box';
import { AiTaskRepositoryError } from '../ai-task.repository';

export const AI_BODY_STORAGE = Symbol('AI_BODY_STORAGE');
export const AI_BODY_STORAGE_VERSION = 'rental-os-ai-body-1';
export const AI_BODY_TITLE_PLACEHOLDER = '[AI私有正文]';
const textPrefix = '__rental_os_ai_body_1__:';
const maxBodyBytes = 2097152;
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
type RecordValue = Record<string, unknown>;
export type AiBodyCipher = Pick<SecretBox, 'encrypt' | 'decrypt'>;

export const isAiBodyRecord = (value: unknown): value is RecordValue => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const emptyBody = (value: unknown) => value === null || value === undefined || value === Prisma.DbNull
  || value === Prisma.JsonNull || value === '' || Array.isArray(value) && value.length === 0
  || isAiBodyRecord(value) && Object.keys(value).length === 0;

/** Retention marks are exact, non-body values. Extra fields must not use this
 * exemption to leave copied prompts or human answers in plaintext. */
function erasureMark(value: unknown) {
  return isAiBodyRecord(value) && value.retention === 'erased'
    && Object.keys(value).length === 3 && typeof value.receiptId === 'string'
    && /^[a-f0-9]{64}$/u.test(value.receiptId) && typeof value.policyVersion === 'string';
}

export class AiBodyStorageCodec {
  constructor(private readonly cipher: AiBodyCipher) {
    if (typeof cipher?.encrypt !== 'function' || typeof cipher.decrypt !== 'function') throw unavailable();
  }

  private context(model: string, path: string, binding: readonly unknown[]) {
    if (!model || !path || !binding.length || binding.some(value =>
      !['string', 'number', 'bigint'].includes(typeof value) || typeof value === 'number' && !Number.isSafeInteger(value))) throw unavailable();
    return createHash('sha256').update(JSON.stringify([AI_BODY_STORAGE_VERSION, model, path,
      binding.map(value => typeof value === 'bigint' ? value.toString() : value)])).digest('hex');
  }

  isSealed(value: unknown) {
    return isAiBodyRecord(value) && Object.prototype.hasOwnProperty.call(value, '__aiBody')
      || typeof value === 'string' && value.startsWith(textPrefix);
  }

  encode(model: string, path: string, binding: readonly unknown[], value: unknown, text = false): unknown {
    if (emptyBody(value) || erasureMark(value)) return value;
    if (text && typeof value !== 'string') throw unavailable();
    try {
      const payload = JSON.stringify(value);
      if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > maxBodyBytes) throw unavailable();
      const sealed = this.cipher.encrypt({ format: AI_BODY_STORAGE_VERSION,
        binding: this.context(model, path, binding), payload });
      // Strings only use TEXT columns. VARCHAR document titles use their
      // encrypted state copy and a fixed, non-sensitive relational marker.
      if (text) {
        const encoded = textPrefix + sealed;
        if (Buffer.byteLength(encoded, 'utf8') > 65535) throw unavailable();
        return encoded;
      }
      return { __aiBody: AI_BODY_STORAGE_VERSION, sealed };
    } catch { throw unavailable(); }
  }

  decode(model: string, path: string, binding: readonly unknown[], value: unknown, text = false): unknown {
    if (!this.isSealed(value)) return value;
    try {
      let sealed: string;
      if (text) {
        if (typeof value !== 'string' || !value.startsWith(textPrefix)) throw unavailable();
        sealed = value.slice(textPrefix.length);
      } else {
        if (!isAiBodyRecord(value) || Object.keys(value).length !== 2
          || value.__aiBody !== AI_BODY_STORAGE_VERSION || typeof value.sealed !== 'string') throw unavailable();
        sealed = value.sealed;
      }
      if (sealed.length > maxBodyBytes * 3 || !SECRET_BOX_ENVELOPE_PATTERN.test(sealed)) throw unavailable();
      const pieces = sealed.split(':').slice(sealed.startsWith('v2:') ? 2 : 1);
      // Database envelopes have one canonical encoding. A changed last base64
      // character must not be accepted merely because it decodes to the same
      // bytes; actual key rotation is still handled by the original SecretBox.
      if (pieces.some(piece => Buffer.from(piece, 'base64url').toString('base64url') !== piece)) throw unavailable();
      const decoded = this.cipher.decrypt(sealed);
      if (Object.keys(decoded).length !== 3 || decoded.format !== AI_BODY_STORAGE_VERSION
        || decoded.binding !== this.context(model, path, binding) || typeof decoded.payload !== 'string'
        || Buffer.byteLength(decoded.payload, 'utf8') > maxBodyBytes) throw unavailable();
      const payload: unknown = JSON.parse(decoded.payload);
      if (text && typeof payload !== 'string') throw unavailable();
      return payload;
    } catch { throw unavailable(); }
  }
}

export function requireAiBodyStorage(db: object): AiBodyStorageCodec {
  const codec: unknown = Reflect.get(db, AI_BODY_STORAGE);
  if (!(codec instanceof AiBodyStorageCodec)) throw unavailable();
  return codec;
}

const clientBinding = (row: RecordValue) => [row.id, row.tenantId, row.workspaceId,
  row.channel, row.principalKind, row.principalHash];

/** Raw SQL repositories use this explicitly at their original parameter/read
 * boundary. No generic SQL parsing, transaction replacement or second copy. */
export function encodeAiClientMaterialBodies(db: object, row: RecordValue) {
  const codec = requireAiBodyStorage(db), binding = clientBinding(row);
  return Object.fromEntries((['command', 'material', 'publication'] as const).map(column =>
    [column, codec.encode('aiClientSceneMaterial', column, binding, row[column])]));
}

export function decodeAiClientMaterialBodies(db: object, row: unknown): unknown {
  if (!isAiBodyRecord(row)) throw unavailable();
  const codec = requireAiBodyStorage(db), binding = clientBinding(row);
  return { ...row, ...Object.fromEntries((['command', 'material', 'publication'] as const).map(column =>
    [column, codec.decode('aiClientSceneMaterial', column, binding, row[column])])) };
}

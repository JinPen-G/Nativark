import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

/**
 * 变更类动作的幂等键（下单、取消、续租、支付单）。
 *
 * 键在动作开始前生成并落本机存储，直到拿到明确结果才清除：网络超时/响应丢失时用**同一个键**
 * 同内容重放，服务端返回原结果，绝不“换个键再试运气”造成重复订单、重复取消或重复扣款。
 */
interface StoredActionKey {
  key: string;
  fingerprint: string;
  createdAt: number;
}

type StoredKeys = Record<string, StoredActionKey>;

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function load(): StoredKeys {
  const stored = readStorage<StoredKeys>(STORAGE_KEYS.actionKeys) ?? {};
  const now = Date.now();
  let changed = false;
  for (const [slot, value] of Object.entries(stored)) {
    if (!value || now - value.createdAt > MAX_AGE_MS) {
      delete stored[slot];
      changed = true;
    }
  }
  if (changed) writeStorage(STORAGE_KEYS.actionKeys, stored);
  return stored;
}

export function newKey(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let random = "";
  for (let index = 0; index < 16; index += 1) random += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/**
 * 取得某个动作的幂等键。同一动作、同一对象、同一内容指纹复用旧键；内容变了才换新键。
 * 例：actionKey("order.cancel", orderId, reason)。
 */
export function actionKey(action: string, subject: string, fingerprint = ""): string {
  const slot = `${action}:${subject}`;
  const keys = load();
  const existing = keys[slot];
  if (existing && existing.fingerprint === fingerprint) return existing.key;
  const created = { key: newKey(action.replace(/[^a-z0-9]+/gi, "-")), fingerprint, createdAt: Date.now() };
  keys[slot] = created;
  writeStorage(STORAGE_KEYS.actionKeys, keys);
  return created.key;
}

export function pendingActionKey(action: string, subject: string): StoredActionKey | undefined {
  return load()[`${action}:${subject}`];
}

/** 动作有了明确结果（成功，或服务端明确拒绝且未产生副作用）后释放键。 */
export function releaseActionKey(action: string, subject: string): void {
  const keys = load();
  if (keys[`${action}:${subject}`]) {
    delete keys[`${action}:${subject}`];
    writeStorage(STORAGE_KEYS.actionKeys, keys);
  }
}

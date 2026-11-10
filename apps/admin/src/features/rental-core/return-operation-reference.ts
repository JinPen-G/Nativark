import { clearSettingsReference, readSettingsReference, retainSettingsReference, type SettingsReferenceStorage } from "../ai-native/settings-operation-reference";

/** Persist only the original batch key and payload digest. Unknown outcomes
 * cannot authorize a different batch or reconstruct customer evidence. */
export interface ReturnOperationReference {
  version: 1;
  scope: string;
  orderId: string;
  kind: "partial" | "inspection" | "deposit";
  key: string;
  hash: string;
}
const storageKey = (scope: string, orderId: string, kind: ReturnOperationReference["kind"]) =>
  scope && orderId ? `rental.return.v1:${encodeURIComponent(scope)}:${encodeURIComponent(orderId)}:${kind}` : "";

export function readReturnOperation(storage: SettingsReferenceStorage | undefined, scope: string, orderId: string, kind: ReturnOperationReference["kind"]) {
  return readSettingsReference<ReturnOperationReference>(storage, storageKey(scope, orderId, kind), value => {
    const row = value as ReturnOperationReference | null;
    return row && row.version === 1 && row.scope === scope && row.orderId === orderId && row.kind === kind
      && typeof row.key === "string" && /^[0-9a-f-]{36}$/u.test(row.key) && typeof row.hash === "string" && /^[0-9a-f]{64}$/u.test(row.hash)
      && Object.keys(row).sort().join(",") === "hash,key,kind,orderId,scope,version" ? row : null;
  });
}

export async function retainReturnOperation(storage: SettingsReferenceStorage | undefined, scope: string, orderId: string,
  kind: ReturnOperationReference["kind"], payload: unknown): Promise<ReturnOperationReference> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(payload))));
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  const key = storageKey(scope, orderId, kind);
  if (kind !== "deposit") {
    const other = readReturnOperation(storage, scope, orderId, kind === "partial" ? "inspection" : "partial");
    if (other.blocked || other.pending) throw new Error("原归还批次结果待核对，不能切换归还入口另建批次");
  }
  const state = readReturnOperation(storage, scope, orderId, kind);
  if (state.blocked || state.pending && state.pending.hash !== hash) throw new Error("原归还批次结果待核对，请保留原数量和检查内容重试，不可另建批次");
  const reference = state.pending ?? { version: 1 as const, scope, orderId, kind, key: crypto.randomUUID(), hash };
  retainSettingsReference(storage, key, reference);
  return reference;
}

export function clearReturnOperation(storage: SettingsReferenceStorage | undefined, reference: ReturnOperationReference) {
  clearSettingsReference(storage, storageKey(reference.scope, reference.orderId, reference.kind), reference);
}

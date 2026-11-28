/** 各端只保存待核原定位；逐操作键避免覆盖其他定位，不存业务正文或认证信息。 */
import { ClientError, type ClientOperationReference, type ClientOperationStore } from "./contracts";
import { clientOperationOwnerKey } from "./operations";

export interface ClientReferenceStorage {
  keys(): readonly string[];
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
export function createClientOperationStore(storage: ClientReferenceStorage, namespace: string): ClientOperationStore {
  if (typeof namespace !== "string" || !namespace || namespace.length > 2048 || /[\u0000-\u001f\u007f]/u.test(namespace)) throw new ClientError("unavailable");
  const partition = encodeURIComponent(namespace);
  const prefix = (owner: Parameters<ClientOperationStore["read"]>[0]) =>
    `${partition}:original:${encodeURIComponent(clientOperationOwnerKey(owner))}:`;
  function project(value: unknown): ClientOperationReference {
    if (!value || typeof value !== "object") throw new ClientError("unavailable");
    const candidate = value as ClientOperationReference;
    const result = { operationKey: candidate.operationKey, coreId: candidate.coreId, routeId: candidate.routeId,
      actionId: candidate.actionId, targetId: candidate.targetId };
    if (Object.values(result).some(field => typeof field !== "string" || !field || field.length > 256))
      throw new ClientError("unavailable");
    return Object.freeze(result);
  }
  const suffix = (reference: ClientOperationReference) => encodeURIComponent(JSON.stringify(Object.values(project(reference))));
  return {
    async read(owner) {
      const start = prefix(owner);
      return storage.keys().filter(key => key.startsWith(start)).map(key => {
        // 损坏的待核定位不能静默丢弃，否则新动作可能绕过“先查原结果”。
        const value = storage.get(key);
        if (value === null) throw new ClientError("unavailable");
        const reference = project(JSON.parse(value));
        if (key !== start + suffix(reference)) throw new ClientError("unavailable");
        return reference;
      });
    },
    async save(owner, reference) {
      const value = JSON.stringify(project(reference)), key = prefix(owner) + suffix(reference);
      storage.set(key, value);
      if (storage.get(key) !== value) throw new ClientError("unavailable");
    },
    async remove(owner, reference) { storage.remove(prefix(owner) + suffix(reference)); },
  };
}

/** Detached ordinary JSON, shared by private original-result validation and
 * external release. Never executes getters/toJSON or coerces missing facts. */
export interface JsonSnapshotLimits {
  stringCharacters: number;
  arrayItems: number;
}

/** Capture only the owner's released fields; ignored private fields are not read.
 * Required fields must be own enumerable data, never accessors or inherited values.
 */
export function snapshotJsonFields(value: unknown, fields: readonly string[], limits: JsonSnapshotLimits): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Read unavailable");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Read unavailable");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const released: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Read unavailable");
    released[field] = snapshotJson(descriptor.value, limits);
  }
  return released;
}

/** Copy each JSON representation; repeated references count again, cycles fail.
 * @param value - unvalidated provider data.
 * @param limits - the owning contract's limits, not caller/model configuration.
 * @param ancestors - current recursion path, not a global object cache.
 * @returns detached ordinary JSON; unsupported values throw before conversion.
 */
export function snapshotJson(value: unknown, limits: JsonSnapshotLimits, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if ([...value].length > limits.stringCharacters) throw new Error("Read unavailable");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error("Read unavailable");
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("Read unavailable");
  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (array ? prototype !== Array.prototype || value.length > limits.arrayItems
    : prototype !== Object.prototype && prototype !== null) throw new Error("Read unavailable");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const fields = array ? keys.filter(key => key !== "length") : keys;
  if (fields.some(key => typeof key !== "string") || array && fields.length !== value.length) throw new Error("Read unavailable");
  ancestors.add(value);
  try {
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of fields) {
      if (typeof key !== "string") throw new Error("Read unavailable");
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Read unavailable");
      snapshot[key] = snapshotJson(descriptor.value, limits, ancestors);
    }
    if (!array) return snapshot;
    return Array.from({ length: value.length }, (_, index) => {
      if (!Object.hasOwn(snapshot, index)) throw new Error("Read unavailable");
      return snapshot[index];
    });
  } finally { ancestors.delete(value); }
}

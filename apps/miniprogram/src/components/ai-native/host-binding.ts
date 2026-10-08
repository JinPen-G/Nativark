/** Instance-private local callbacks, never serialized or interpreted as authorization. */
const actions = new WeakMap<object, (input: unknown) => Promise<void>>();
export function bindHostAction(instance: object, action: (input: unknown) => Promise<void>): void {
  if (typeof action !== "function") throw new Error("宿主动作不可用");
  actions.set(instance, action);
}
export function unbindHostAction(instance: object): void { actions.delete(instance); }
export function hostAction(instance: object): ((input: unknown) => Promise<void>) | undefined { return actions.get(instance); }

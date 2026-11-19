/** HTTP 令牌只转发同一业务实例；Nest 生命周期由 RentalApplicationLifecycle 唯一调用。
 * 不代理数据库、不复制状态或构造第二个执行者；原方法的 this 始终是原实例。 */
import type { RentalHttpServiceGroups } from "@rental-os/rental-core/http";

const lifecycleHooks = new Set<PropertyKey>(["onModuleInit", "onApplicationBootstrap", "onModuleDestroy",
  "beforeApplicationShutdown", "onApplicationShutdown"]);

export function createRentalHttpApplicationViews(services: RentalHttpServiceGroups): RentalHttpServiceGroups {
  const views = new WeakMap<object, object>();
  function view<T extends object>(instance: T): T {
    const existing = views.get(instance);
    if (existing) return existing as T;
    const methods = new Map<PropertyKey, { original: Function; bound: Function }>();
    const result = new Proxy(instance, {
      get(target, key) {
        if (lifecycleHooks.has(key)) return undefined;
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function" || key === "constructor") return value;
        const method = methods.get(key);
        if (method?.original === value) return method.bound;
        const bound = value.bind(target);
        methods.set(key, { original: value, bound });
        return bound;
      }
    });
    views.set(instance, result);
    return result;
  }
  return { ...services, rental: { ...services.rental,
    core: view(services.rental.core), business: view(services.rental.business),
    allocation: view(services.rental.allocation), idempotent: view(services.rental.idempotent) } };
}

/** 标准 Rental 宿主的 Nest 请求生命周期。原 identity/staff routing middleware 必须先运行，
 * 唯一 Guard 由平台模块分流；本拦截器不再次认证。仅托管显式审定处理器的一次缓冲订阅，
 * 不启动服务器、不制造匿名身份、不把断线解释成事务回滚或允许重发。 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ServiceUnavailableException, StreamableFile, type CallHandler, type ExecutionContext,
  type NestInterceptor, type NestMiddleware } from "@nestjs/common";
import { EmptyError, Observable, Subscriber } from "rxjs";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import type { RentalApplicationAccess, RentalApplicationAccessRequest } from "@rental-os/rental-core/application-access";
import type { RentalPublicApplicationAccess } from "@rental-os/rental-core/application-public-access";
import { createRentalNativeResponseBuffer, type RentalHttpAccessPolicy } from "@rental-os/rental-core/http-access-policy";
import type { RentalPlatformRequest } from "@rental-os/rental-core/application-platform";

interface RentalRequest extends RentalApplicationAccessRequest, RentalPlatformRequest {
  aborted?: boolean;
}
interface RentalResponse {
  once(event: "finish" | "close", listener: () => void): unknown;
  removeListener(event: "finish" | "close", listener: () => void): unknown;
  writableEnded?: boolean;
  destroyed?: boolean;
}
type Resume = <T>(consume: () => T) => T;
type RequestScope = {
  active: boolean;
  claimed: boolean;
  method: string;
  path: string;
  staff: boolean;
  anonymous: boolean;
  identityOnly: boolean;
  identity: NonNullable<ReturnType<typeof getRequestIdentity>>;
  resume: Resume;
  stop(error?: unknown): void;
  cancel?: (error: unknown) => void;
};

const ended = () => new Error("Rental HTTP 请求已结束；在途操作结果仍须按原操作键核对");

/** Register middleware after requestIdentityMiddleware and original staff routing,
 * before Nest's sole Guard. Register interceptor inside response-transforming
 * interceptors so it observes the handler value before an envelope is added.
 * routesToPlatform MUST be assembly.platform.routesToPlatform from the same assembly. */
export function createRentalHttpRequestScope(input: {
  access: Pick<RentalApplicationAccess, "run" | "withRequest">;
  publicAccess?: Pick<RentalPublicApplicationAccess, "run" | "withRequest">;
  isClientPublicRoute?(method: string, path: string): boolean;
  policy: RentalHttpAccessPolicy;
  routesToPlatform(request: RentalPlatformRequest): boolean;
}): { middleware: NestMiddleware<RentalRequest, RentalResponse>; interceptor: NestInterceptor } {
  if (typeof input?.access?.run !== "function" || typeof input.access.withRequest !== "function"
    || typeof input.policy?.requireHandler !== "function" || typeof input.routesToPlatform !== "function") {
    throw new Error("Rental HTTP 缺少同实例应用准入、已审定处理器或公共分流函数");
  }
  if (Boolean(input.publicAccess) !== Boolean(input.isClientPublicRoute)
    || input.publicAccess && (typeof input.publicAccess.run !== "function" || typeof input.publicAccess.withRequest !== "function")) {
    throw new Error("Rental 公开请求须同时供给同实例公开准入和原 Guard 公开路由政策");
  }
  const { access, publicAccess, isClientPublicRoute, policy, routesToPlatform } = input;
  const scopes = new WeakMap<RentalRequest, RequestScope>();
  const identities = new WeakSet<object>();
  const assertActive = (request: RentalRequest, scope: RequestScope) => {
    if (!scope.active || getRequestIdentity() !== scope.identity || request.aborted || request.method.toUpperCase() !== scope.method
      || matchableRequestPath(request.url) !== scope.path || (request.staffApiRequest === true) !== scope.staff
      || Boolean(isClientPublicRoute?.(request.method.toUpperCase(), matchableRequestPath(request.url))) !== scope.anonymous
      || Boolean(policy.isIdentityRoute?.(request)) !== scope.identityOnly
      || routesToPlatform(request)) throw ended();
  };
  const middleware: NestMiddleware<RentalRequest, RentalResponse> = {
    async use(request, response, next: (error?: unknown) => void) {
      let scope: RequestScope | undefined;
      try {
        if (scopes.has(request)) throw new Error("Rental HTTP 请求不能重复进入 middleware");
        if (routesToPlatform(request)) { next(); return; }
        const identity = getRequestIdentity();
        if (!identity || identities.has(identity)) throw new Error("Rental HTTP 需要原 middleware 为每个请求建立独立身份上下文");
        identities.add(identity);
        if (typeof response?.once !== "function" || typeof response.removeListener !== "function"
          || response.writableEnded || response.destroyed || request.aborted) throw ended();
        const anonymous = Boolean(isClientPublicRoute?.(request.method.toUpperCase(), matchableRequestPath(request.url)));
        const identityOnly = Boolean(policy.isIdentityRoute?.(request));
        if (identityOnly && anonymous) throw new Error("原身份维护不能借用客户公开业务范围");
        const run = <T>(consume: () => Promise<T>) => identityOnly ? consume()
          : anonymous ? publicAccess!.run(consume) : access.run(consume);
        await run(async () => {
          let release!: () => void;
          const lifetime = new Promise<void>(resolve => { release = resolve; });
          const closed = () => scope!.stop(ended());
          scope = {
            active: true, claimed: false, method: request.method.toUpperCase(), path: matchableRequestPath(request.url),
            staff: request.staffApiRequest === true, anonymous, identityOnly, identity, resume: AsyncLocalStorage.snapshot(),
            stop(error = ended()) {
              if (!scope!.active) return;
              scope!.active = false;
              response.removeListener("finish", closed);
              response.removeListener("close", closed);
              const cancel = scope!.cancel;
              scope!.cancel = undefined;
              // Releasing run expires the original per-application fence as well.
              // Already-dispatched database/external work is not forcibly rolled back.
              release();
              if (cancel) scope!.resume(() => cancel(error));
            }
          };
          scopes.set(request, scope);
          response.once("finish", closed);
          response.once("close", closed);
          try {
            // The original Nest Guard runs exactly once downstream of this next().
            next();
            await lifetime;
          } finally { scope.stop(); }
        });
      } catch (error) {
        scope?.stop(error);
        next(error);
      }
    }
  };

  const interceptor: NestInterceptor = {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      if (context.getType() !== "http") return next.handle();
      const request = context.switchToHttp().getRequest<RentalRequest>();
      const scope = scopes.get(request);
      // Public platform / standard Core use their existing middleware and Guard.
      // An already selected Rental request cannot change its path to borrow this exit.
      if (!scope && routesToPlatform(request)) return next.handle();
      if (!scope) throw new ServiceUnavailableException("Rental HTTP 缺少 Guard 之前的请求 middleware");
      try {
        assertActive(request, scope);
        if (scope.claimed) throw new Error("Rental HTTP 原处理器只能绑定一次");
        scope.claimed = true;
        const route = policy.requireHandler(context.getClass(), context.getHandler(), request);
        if ((route.review.ingress === "platform-identity") !== scope.identityOnly) {
          throw new ServiceUnavailableException("Rental 原身份入口与实际处理器不一致");
        }
        const native = route.review.response === "buffered-native"
          ? createRentalNativeResponseBuffer(context.switchToHttp().getResponse()) : undefined;
        if (scope.anonymous && (route.review.kind === "audited-read" || route.review.kind === "maintained-read")) {
          throw new ServiceUnavailableException("Rental 公开审计读取尚未登记专用接点");
        }
        let subscribed = false;
        return new Observable(destination => {
          if (subscribed) { destination.error(new Error("Rental HTTP 不允许重复订阅或自动重试原处理器")); return; }
          subscribed = true;
          let cancelSource: ((error: unknown) => void) | undefined;
          scope.cancel = error => {
            native?.discard();
            cancelSource?.(error);
            destination.error(error);
          };
          const consume = () => new Promise<unknown>((resolve, reject) => {
            assertActive(request, scope);
            let received = false, settled = false, value: unknown;
            const fail = (error: unknown) => {
              if (settled) return;
              settled = true;
              cancelSource = undefined;
              source.unsubscribe();
              reject(error);
            };
            const source = new Subscriber<unknown>({
              next(current) {
                if (received || current instanceof StreamableFile || current !== null && typeof current === "object"
                  && (Symbol.asyncIterator in current || "pipe" in current && typeof current.pipe === "function")) {
                  fail(new ServiceUnavailableException("Rental HTTP 已审定处理器只能返回单个缓冲结果；流需要专用接点"));
                  return;
                }
                received = true;
                value = current;
              },
              error: fail,
              complete() {
                if (settled) return;
                if (!received) { fail(new EmptyError()); return; }
                settled = true;
                cancelSource = undefined;
                resolve(value);
              }
            });
            cancelSource = fail;
            try { next.handle().subscribe(source); } catch (error) { fail(error); }
          });
          try {
            scope.resume(() => {
              assertActive(request, scope);
              const consumeResponse = native ? () => native.run(consume) : consume;
              const result = scope.identityOnly ? consumeResponse() : scope.anonymous
                ? publicAccess!.withRequest(request, consumeResponse, route.review.kind === "buffered-read" ? { bufferedRead: true } : undefined)
                : access.withRequest(request, consumeResponse, route.review.kind === "buffered-read" ? { bufferedRead: true }
                  : route.review.kind === "audited-read" ? { auditedRead: true }
                    : route.review.kind === "maintained-read" ? { maintainedRead: true } : undefined);
              void result.then(value => {
                // No write authorization check after commit. Reads already passed the
                // access adapter's pre-return recheck with the original Guard identity.
                if (!scope.active || destination.closed) { native?.discard(); return; }
                scope.cancel = undefined;
                scope.stop();
                try { native?.flush(); destination.next(value); destination.complete(); }
                catch (error) { destination.error(error); }
              }, error => { native?.discard(); scope.cancel = undefined; scope.stop(error); destination.error(error); });
            });
          } catch (error) { native?.discard(); scope.stop(error); destination.error(error); }
          return () => { native?.discard(); scope.stop(); };
        });
      } catch (error) { scope.stop(error); throw error; }
    }
  };
  return Object.freeze({ middleware, interceptor });
}

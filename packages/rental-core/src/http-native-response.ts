/** 原二进制/CSV响应的提交接点。标准宿主收集原处理器的有限输出，在权限复验后一次发送；
 * 未选择该宿主的兼容入口沿原响应。这里不下载文件、不读取对象，也不解释或放宽 URL 政策。 */
import { AsyncLocalStorage } from "node:async_hooks";
import { validateHeaderName, validateHeaderValue } from "node:http";

export interface RentalNativeResponse {
  setHeader(name: string, value: string): unknown;
  send?(body: Buffer | string): unknown;
  redirect?(status: number, url: string): unknown;
}
type Output = { kind: "body"; body: Buffer | string } | { kind: "redirect"; status: number; url: string };
type Scope = { active: boolean; claimed: boolean; target: RentalNativeResponse;
  headers: Map<string, { name: string; value: string }>; output?: Output };
const scopes = new AsyncLocalStorage<Scope>();

/** Controllers call this before touching @Res. It exposes only the original
 * bounded response operations, with no socket/stream or early flush escape. */
export function rentalNativeResponse<T extends RentalNativeResponse>(response: T): T {
  const scope = scopes.getStore();
  if (!scope) return response;
  if (!scope.active || scope.claimed || response !== scope.target) throw new Error("Rental 原生响应对象或生命周期不一致");
  scope.claimed = true;
  const active = () => {
    if (!scope.active || scope.output) throw new Error("Rental 原生响应只能在处理器内准备一次");
  };
  return {
    setHeader(name: string, value: string) {
      active(); validateHeaderName(name); validateHeaderValue(name, value);
      if (typeof value !== "string") throw new Error("Rental 原生响应头必须来自原处理器字符串");
      scope.headers.set(name.toLowerCase(), { name, value });
    },
    send(body: Buffer | string) {
      active();
      if (!Buffer.isBuffer(body) && typeof body !== "string") throw new Error("Rental 原生响应只支持已缓冲字节或文本");
      if (typeof scope.target.send !== "function") throw new Error("Rental 宿主未提供原二进制响应");
      scope.output = { kind: "body", body: Buffer.isBuffer(body) ? Buffer.from(body) : body };
    },
    redirect(status: number, url: string) {
      active();
      if (!Number.isSafeInteger(status) || status < 300 || status >= 400 || typeof url !== "string" || !url
        || typeof scope.target.redirect !== "function") throw new Error("Rental 原处理器跳转响应无效");
      validateHeaderValue("Location", url);
      scope.output = { kind: "redirect", status, url };
    }
  } as T;
}

/** One collector per reviewed handler subscription. discard wins on error or
 * disconnect; authorization and original service validation precede flush. */
export function createRentalNativeResponseBuffer(target: RentalNativeResponse) {
  if (typeof target?.setHeader !== "function") throw new Error("Rental 缺少原 HTTP 响应对象");
  const scope: Scope = { active: false, claimed: false, target, headers: new Map() };
  let entered = false, prepared = false, finished = false;
  const clear = () => { scope.headers.clear(); scope.output = undefined; };
  return Object.freeze({
    async run<T>(consume: () => Promise<T>): Promise<T> {
      if (entered || finished || scopes.getStore()) throw new Error("Rental 原生响应不能嵌套或重复执行");
      entered = true; scope.active = true;
      try {
        return await scopes.run(scope, async () => {
          const result = await consume();
          if (!scope.claimed || finished) throw new Error("Rental 原生处理器未登记输出或请求已结束");
          prepared = true;
          return result;
        });
      } catch (error) { finished = true; clear(); throw error; }
      finally { scope.active = false; }
    },
    discard() { finished = true; scope.active = false; clear(); },
    flush() {
      if (!prepared || scope.active || finished) throw new Error("Rental 原生响应未复核或已发送");
      finished = true;
      try {
        for (const { name, value } of scope.headers.values()) target.setHeader(name, value);
        if (scope.output?.kind === "body") target.send!(scope.output.body);
        else if (scope.output?.kind === "redirect") target.redirect!(scope.output.status, scope.output.url);
      } finally { clear(); }
    }
  });
}

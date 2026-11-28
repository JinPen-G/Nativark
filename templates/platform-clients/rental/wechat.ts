/** 微信端只适配原运输与凭据槽；随机源不可用时拒绝动作接线，不退回时间戳或 Math.random。 */
import { ClientError, type ClientAccessPort } from "@rental-os/platform-client-contracts";
import { createRentalCustomerClient, createRentalStaffClient, RentalClientHttpError,
  type RentalContributionTransport } from "@rental-os/rental-core/clients/contribution";
import { connection, credentialProjection, credentialText, rentalAccess, RENTAL_CLIENT_VERSION, type RentalClientHostConfiguration } from "./config";

type WechatHost = Pick<WechatMiniprogram.Wx, "request" | "getStorageSync" | "setStorageSync" | "removeStorageSync" | "getRandomValues">;
export async function createRentalWechatAssembly(surface: "wechat-customer" | "wechat-staff",
  configuration: RentalClientHostConfiguration | undefined, host: WechatHost, currentPageAccess?: ClientAccessPort) {
  if (!configuration) return undefined;
  const selected = connection(configuration, surface);
  const seed = await new Promise<string>((resolve, reject) => {
    if (typeof host.getRandomValues !== "function") { reject(new ClientError("unavailable")); return; }
    host.getRandomValues({ length: 16, success(value) {
      if (value.randomValues.byteLength !== 16) { reject(new ClientError("unavailable")); return; }
      resolve([...new Uint8Array(value.randomValues)].map(byte => byte.toString(16).padStart(2, "0")).join(""));
    }, fail: () => reject(new ClientError("unavailable")) });
  });
  let sequence = 0;
  const transport: RentalContributionTransport = { request<T>(input: Parameters<RentalContributionTransport["request"]>[0]): Promise<T> {
    input.lifetime?.assertCurrent();
    return new Promise<T>((resolve, reject) => {
      let finished = false, unsubscribe: (() => void) | undefined;
      const settle = (work: () => void) => { if (finished) return; finished = true; unsubscribe?.(); work(); };
      const task = host.request({ url: selected.url(input.path), method: input.method, data: input.body as WechatMiniprogram.RequestOption["data"],
        header: { "Content-Type": "application/json", ...input.headers, ...(input.authorization ? { Authorization: input.authorization } : {}) },
        timeout: 30000, dataType: "json", responseType: "text",
        success(response) { settle(() => {
          try {
            input.lifetime?.assertCurrent();
            if (response.statusCode < 200 || response.statusCode >= 300) throw new RentalClientHttpError(response.statusCode);
            resolve(response.data as T);
          } catch (error) { reject(error); }
        }); },
        fail() { settle(() => reject(new ClientError(input.lifetime && !input.lifetime.current() ? "stale" : "unavailable"))); },
      });
      if (!finished) unsubscribe = input.lifetime?.onCancel(() => {
        settle(() => reject(new ClientError("stale"))); task.abort();
      });
    });
  } };
  const credentials = {
    read() { const value: unknown = host.getStorageSync(selected.key); return credentialProjection(typeof value === "string" ? value : null); },
    write(value: Parameters<typeof credentialText>[0]) {
      const text = credentialText(value); host.setStorageSync(selected.key, text);
      if (host.getStorageSync(selected.key) !== text) throw new ClientError("unavailable");
    },
    clear: () => host.removeStorageSync(selected.key),
  };
  const createOperationKey = () => {
    if (!Number.isSafeInteger(++sequence)) throw new ClientError("unavailable");
    return `${seed}:${sequence}`; // 每次启动独立的安全随机前缀；原引用恢复不调用此函数。
  };
  const factory = surface === "wechat-customer" ? createRentalCustomerClient : createRentalStaffClient;
  const rental = factory({ tenantCode: configuration.tenantCode, version: RENTAL_CLIENT_VERSION,
    clientId: `miniprogram:${configuration.appId ?? ""}`, transport, credentials, createOperationKey });
  return { session: rental.session, access: rentalAccess(rental.access, currentPageAccess), contributions: [rental.contribution], brand: configuration.brand,
    operationNamespace: selected.key.replace(/:credentials$/u, ":operations") };
}

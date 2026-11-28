/** Rental Web 选装接线：正式贡献工厂 + 单次 HTTP 运输 + 独立凭据槽。没有业务查询或认证替代实现。 */
import { ClientError } from "@rental-os/platform-client-contracts";
import { createRentalCustomerClient, createRentalStaffClient, RentalClientHttpError,
  type RentalContributionTransport } from "@rental-os/rental-core/clients/contribution";
import { connection, credentialProjection, credentialText, responseBody, RENTAL_CLIENT_VERSION, type RentalClientHostConfiguration } from "./config";

export function createRentalWebAssembly(surface: "customer-web" | "staff-web", configuration: RentalClientHostConfiguration | undefined,
  host: Pick<Window, "fetch" | "sessionStorage" | "crypto">) {
  if (!configuration) return undefined;
  const selected = connection(configuration, surface), storage = host.sessionStorage;
  const transport: RentalContributionTransport = { async request<T>(input: Parameters<RentalContributionTransport["request"]>[0]): Promise<T> {
    input.lifetime?.assertCurrent();
    const abort = new AbortController(), unsubscribe = input.lifetime?.onCancel(() => abort.abort());
    try {
      const response = await host.fetch(selected.url(input.path), { method: input.method,
        headers: { "Content-Type": "application/json", ...input.headers, ...(input.authorization ? { Authorization: input.authorization } : {}) },
        body: input.body === undefined ? undefined : JSON.stringify(input.body), signal: abort.signal,
        credentials: "omit", cache: "no-store", redirect: "error" });
      input.lifetime?.assertCurrent();
      if (!response.ok) throw new RentalClientHttpError(response.status);
      const result = responseBody<T>(await response.json());
      input.lifetime?.assertCurrent();
      return result;
    } finally { unsubscribe?.(); }
  } };
  const credentials = {
    read: () => credentialProjection(storage.getItem(selected.key)),
    write(value: Parameters<typeof credentialText>[0]) {
      const text = credentialText(value); storage.setItem(selected.key, text);
      if (storage.getItem(selected.key) !== text) throw new ClientError("unavailable");
    },
    clear: () => storage.removeItem(selected.key),
  };
  const createOperationKey = () => {
    const bytes = host.crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  };
  const factory = surface === "customer-web" ? createRentalCustomerClient : createRentalStaffClient;
  const rental = factory({ tenantCode: configuration.tenantCode, version: RENTAL_CLIENT_VERSION, clientId: "website",
    transport, credentials, createOperationKey });
  return { session: rental.session, access: rental.access, contributions: [rental.contribution], brand: configuration.brand,
    operationNamespace: selected.key.replace(/:credentials$/u, ":operations") };
}

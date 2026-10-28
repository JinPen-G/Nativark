import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { isIP } from "node:net";
import type { ModelJsonTransport } from "./chat-completions.adapter";
import { ModelGatewayError } from "./model-gateway.ports";
import { modelEgressUrl, publicModelAddress } from "./model-egress-policy";
import { MODEL_HEADER_BYTES, MODEL_REQUEST_BYTES, modelByteLimit, ModelResponseBuffer, ModelResponseStreamValidator } from "./model-response-limits";
const nativeTransports = new WeakSet<object>();
export function modelEgressEvidence(transport: ModelJsonTransport): 'live' | 'mock' {
  return nativeTransports.has(transport) ? 'live' : 'mock';
}
export function createNativeModelEgressTransport(timeoutMs = 30000) {
  const transport = new ModelEgressTransport({
    resolve: hostname => import('node:dns/promises').then(dns => dns.lookup(hostname, { all: true, verbatim: true })),
    request: (options, response) => require('node:https').request(options, response),
    now: Date.now, setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>)
  }, timeoutMs);
  nativeTransports.add(transport);
  return Object.freeze(transport);
}
export interface ModelEgressDependencies {
  resolve(hostname: string): Promise<Array<{ address: string; family: number }>>;
  request(options: RequestOptions, response: (response: IncomingMessage) => void): ClientRequest;
  now(): number;
  setTimer(callback: () => void, delay: number): unknown;
  clearTimer(timer: unknown): void;
}
/** Explicitly injected transport; never registered by AppModule or substituted for missing ports. */
export class ModelEgressTransport implements ModelJsonTransport {
  constructor(private readonly dependencies: ModelEgressDependencies, private readonly timeoutMs = 30000) {
    if (!dependencies || [dependencies.resolve, dependencies.request, dependencies.now, dependencies.setTimer, dependencies.clearTimer].some(v => typeof v !== "function") || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new ModelGatewayError("CONFIG_INVALID");
  }
  async post(input: Parameters<ModelJsonTransport["post"]>[0]): Promise<{ status: number; body: string }> {
    return this.performPost(input);
  }
  /** Authenticated model-directory GET. Fixed by the setup service, not an
   * arbitrary URL tool; identical DNS pinning, TLS, deadlines and byte caps. */
  async getModelDirectory(input: Omit<Parameters<ModelJsonTransport['post']>[0], 'body' | 'redirects'>) {
    const headers = input.headers;
    const bearer = Object.keys(headers).length === 2 && Object.keys(headers).every(k => ['Authorization', 'Content-Type'].includes(k))
      && /^Bearer [\x21-\x7e]{1,8192}$/u.test(headers.Authorization ?? '');
    const messages = Object.keys(headers).length === 3 && Object.keys(headers).every(k => ['x-api-key', 'anthropic-version', 'Content-Type'].includes(k))
      && /^[\x21-\x7e]{1,8192}$/u.test(headers['x-api-key'] ?? '') && headers['anthropic-version'] === '2023-06-01';
    if ((!bearer && !messages) || headers['Content-Type'] !== 'application/json'
      || !new URL(input.url).pathname.endsWith('/models')) throw new ModelGatewayError('CONFIG_INVALID');
    return this.performPost({ ...input, body: '', redirects: 'error' }, undefined, undefined, undefined, undefined, 'GET');
  }
  /** Signed object reads share address pinning/TLS/limits, not model auth or
   * invocation authority. No redirects, ambient credentials or GET body. */
  async get(input: { url: string; headers: Readonly<Record<string, string>>; signal: AbortSignal; maxResponseBytes: number }) {
    const headers = input.headers;
    if (Object.keys(headers).length !== 3 || Object.keys(headers).some(key => !['Authorization', 'x-amz-date', 'x-amz-content-sha256'].includes(key))
      || !/^AWS4-HMAC-SHA256 Credential=[^\s,]+, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/u.test(headers.Authorization ?? '')
      || !/^[0-9]{8}T[0-9]{6}Z$/u.test(headers['x-amz-date'] ?? '')
      || !/^[a-f0-9]{64}$/u.test(headers['x-amz-content-sha256'] ?? '')) throw new ModelGatewayError('CONFIG_INVALID');
    let responseHeaders: Readonly<Record<string, string>> = {};
    const chunks: Buffer[] = [];
    const result = await this.performPost({ ...input, body: '', redirects: 'error' }, undefined,
      bytes => chunks.push(Buffer.from(bytes)), response => {
      const names = response.rawHeaders.filter((_value, index) => index % 2 === 0).map(name => name.toLowerCase());
      if (['content-type', 'content-length'].some(name => names.filter(value => value === name).length !== 1))
        throw new ModelGatewayError('INVALID_RESPONSE');
      const type = response.headers['content-type'], length = response.headers['content-length'];
      if (typeof type !== 'string' || typeof length !== 'string' || !/^[0-9]+$/u.test(length)
        || !Number.isSafeInteger(Number(length)) || Number(length) > input.maxResponseBytes)
        throw new ModelGatewayError('INVALID_RESPONSE');
      responseHeaders = { 'content-type': type, 'content-length': length };
    }, undefined, 'GET');
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== Number(responseHeaders['content-length'])) throw new ModelGatewayError('INVALID_RESPONSE');
    return { status: result.status, bytes, headers: responseHeaders };
  }
  async *postStream(input: Parameters<ModelJsonTransport["post"]>[0]): ReturnType<NonNullable<ModelJsonTransport["postStream"]>> {
    if (!input.signal || typeof input.signal.addEventListener !== "function") throw new ModelGatewayError("CONFIG_INVALID");
    const controller = new AbortController(), queue: Array<{ kind: "headers"; status: number } | { kind: "chunk"; bytes: Uint8Array }> = [];
    let queuedBytes = 0, done = false, error: unknown, wake: (() => void) | undefined;
    let incoming: IncomingMessage | undefined, paused = false;
    const cancel = () => controller.abort();
    if (input.signal?.aborted) cancel();
    input.signal?.addEventListener("abort", cancel, { once: true });
    const notify = () => { wake?.(); wake = undefined; };
    const push = (event: (typeof queue)[number]) => {
      if (controller.signal.aborted) throw new ModelGatewayError("CANCELLED");
      queuedBytes += event.kind === "chunk" ? event.bytes.byteLength : 0;
      if (queuedBytes > input.maxResponseBytes || queue.length >= 256) throw new ModelGatewayError("INVALID_RESPONSE");
      queue.push(event);
      // Bound both event count and bytes. Pause a cooperative Node response BEFORE
      // the hard cap; keep that cap for peers which ignore pause or injected fakes.
      if (!paused && incoming && typeof incoming.pause === 'function' && (queue.length >= 32 || queuedBytes >= 65536)) {
        paused = true; incoming.pause();
      }
      notify();
    };
    const operation = this.performPost({ ...input, signal: controller.signal }, status => push({ kind: "headers", status }),
      bytes => push({ kind: "chunk", bytes: Uint8Array.from(bytes) }), response => { incoming = response; }, failure => { error = failure; notify(); })
      .catch(failure => { error = failure; }).finally(() => { done = true; notify(); });
    try {
      for (;;) {
        if (error) throw error;
        if (input.signal?.aborted) throw new ModelGatewayError("CANCELLED");
        const event = queue.shift();
        if (event) {
          queuedBytes -= event.kind === "chunk" ? event.bytes.byteLength : 0;
          if (paused && queue.length <= 8 && queuedBytes <= 16384 && !done && !controller.signal.aborted && incoming && !incoming.destroyed) {
            paused = false; incoming.resume();
          }
          yield event; continue;
        }
        if (done) break;
        await new Promise<void>(resolve => { wake = resolve; });
      }
    } finally {
      controller.abort(); input.signal?.removeEventListener("abort", cancel);
      await operation;
      queue.length = 0; queuedBytes = 0; incoming = undefined;
    }
  }
  private async performPost(input: Parameters<ModelJsonTransport["post"]>[0], onHeaders?: (status: number) => void,
    onChunk?: (bytes: Uint8Array) => void, onResponse?: (response: IncomingMessage) => void,
    onFailure?: (error: ModelGatewayError) => void, method: 'POST' | 'GET' = 'POST'): Promise<{ status: number; body: string }> {
    const url = modelEgressUrl(input.url), limit = modelByteLimit(input.maxResponseBytes);
    if (input.redirects !== "error" || typeof input.body !== "string" || Buffer.byteLength(input.body) > MODEL_REQUEST_BYTES || !input.signal || input.signal.aborted) throw new ModelGatewayError(input.signal?.aborted ? "CANCELLED" : "CONFIG_INVALID");
    const entries = Object.entries(input.headers);
    // Exactly one protocol authentication shape; never arbitrary SDK headers,
    // ambient credentials, duplicate casing or mixed Bearer/API-key modes.
    const bearer = entries.length === 2 && Object.keys(input.headers).every(key => ['Authorization', 'Content-Type'].includes(key))
      && /^Bearer [\x21-\x7e]{1,8192}$/u.test(input.headers.Authorization ?? '');
    const messages = entries.length === 3 && Object.keys(input.headers).every(key => ['x-api-key', 'anthropic-version', 'Content-Type'].includes(key))
      && /^[\x21-\x7e]{1,8192}$/u.test(input.headers['x-api-key'] ?? '') && input.headers['anthropic-version'] === '2023-06-01';
    if (method === 'POST' && ((!bearer && !messages) || input.headers['Content-Type'] !== 'application/json')
      || entries.some(([, value]) => typeof value !== 'string' || /[^\x20-\x7e]/u.test(value))
      || entries.reduce((n, [key, value]) => n + Buffer.byteLength(key + value), 0) > MODEL_HEADER_BYTES) throw new ModelGatewayError('CONFIG_INVALID');
    input = { ...input, headers: Object.freeze({ ...input.headers }) };
    const start = this.dependencies.now();
    if (!Number.isFinite(start)) throw new ModelGatewayError("CONFIG_INVALID");
    const deadline = start + this.timeoutMs;
    return new Promise((resolve, reject) => {
      let settled = false, request: ClientRequest | undefined, response: IncomingMessage | undefined, timer: unknown;
      const finish = (error?: ModelGatewayError, result?: { status: number; body: string }) => {
        if (settled) return; settled = true;
        input.signal.removeEventListener("abort", cancel);
        if (timer !== undefined) this.dependencies.clearTimer(timer);
        response?.removeAllListeners("data"); response?.removeAllListeners("end");
        if (error) { onFailure?.(error); response?.destroy(); request?.destroy(); reject(error); }
        else resolve(result!);
      };
      const cancel = () => finish(new ModelGatewayError("CANCELLED"));
      const expired = () => !Number.isFinite(this.dependencies.now()) || this.dependencies.now() >= deadline;
      input.signal.addEventListener("abort", cancel, { once: true });
      timer = this.dependencies.setTimer(() => finish(new ModelGatewayError("TIMEOUT")), this.timeoutMs);
      const host = url.hostname.replace(/^\[|\]$/gu, "");
      const addresses = isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : Promise.resolve().then(() => this.dependencies.resolve(host));
      addresses.then(records => {
        if (settled) return;
        if (expired()) { finish(new ModelGatewayError("TIMEOUT")); return; }
        if (!Array.isArray(records) || records.length < 1 || records.length > 64) throw new ModelGatewayError("CONFIG_INVALID");
        const pinned = records.map(record => {
          if (!record || typeof record.address !== "string" || ![4, 6].includes(record.family)) throw new ModelGatewayError("CONFIG_INVALID");
          return publicModelAddress(record.address, record.family);
        })[0];
        // hostname remains original for Host/certificate validation. lookup returns ONLY pinned validated IP.
        const lookup: RequestOptions["lookup"] = (_hostname, options, callback) => {
          if (settled || _hostname !== host) { callback(new Error("EGRESS_DENIED"), "", 4); return; }
          if (typeof options === "object" && options.all) (callback as unknown as (error: null, addresses: typeof pinned[]) => void)(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        };
        request = this.dependencies.request({ protocol: "https:", hostname: host, port: url.port || 443, path: url.pathname,
          method, headers: { ...input.headers, ...(method === 'POST' ? { "Content-Length": Buffer.byteLength(input.body) } : {}) },
          agent: false, lookup, rejectUnauthorized: true, servername: isIP(host) ? "" : host, maxHeaderSize: MODEL_HEADER_BYTES }, incoming => {
          response = incoming;
          incoming.on("error", () => finish(new ModelGatewayError("PROVIDER_FAILED")));
          incoming.on("aborted", () => finish(new ModelGatewayError("PROVIDER_FAILED")));
          if (settled) { incoming.destroy(); return; }
          const status = incoming.statusCode;
          const raw = incoming.rawHeaders;
          if (!Number.isInteger(status) || !status || status < 100 || status > 599 || !Array.isArray(raw) || raw.reduce((n, value) => n + Buffer.byteLength(value), 0) > MODEL_HEADER_BYTES || (incoming.headers["content-encoding"] && incoming.headers["content-encoding"] !== "identity") || (status >= 300 && status <= 399)) { finish(new ModelGatewayError("INVALID_RESPONSE")); return; }
          try { onResponse?.(incoming); onHeaders?.(status); } catch (error) { finish(error instanceof ModelGatewayError ? error : new ModelGatewayError("INVALID_RESPONSE")); return; }
          const buffer = onChunk ? new ModelResponseStreamValidator(limit) : new ModelResponseBuffer(limit);
          incoming.on("data", chunk => { if (settled) return; try { if (expired()) throw new ModelGatewayError("TIMEOUT"); buffer.append(chunk); onChunk?.(chunk); } catch (error) { finish(error instanceof ModelGatewayError ? error : new ModelGatewayError("INVALID_RESPONSE")); } });
          incoming.on("end", () => { if (settled) return; try { if (expired()) throw new ModelGatewayError("TIMEOUT"); finish(undefined, { status, body: buffer.text() }); } catch (error) { finish(error instanceof ModelGatewayError ? error : new ModelGatewayError("INVALID_RESPONSE")); } });
          incoming.on("close", () => { if (!settled) finish(new ModelGatewayError("PROVIDER_FAILED")); });
        });
        request.on("error", () => finish(new ModelGatewayError("PROVIDER_FAILED")));
        if (settled || input.signal.aborted) { request.destroy(); return; }
        request.end(method === 'POST' ? input.body : undefined);
      }).catch(error => finish(error instanceof ModelGatewayError ? error : new ModelGatewayError("CONFIG_INVALID")));
    });
  }
}

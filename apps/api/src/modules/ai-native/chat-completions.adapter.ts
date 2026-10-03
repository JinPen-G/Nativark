import { z } from "zod";
import { normalizeTenantModelBaseUrl } from "./tenant-model-config.service";
import { ModelAdapterError, ModelGatewayError, type AdapterResult, type AdapterStreamEvent, type ModelAdapter, type ModelFeature, type ModelRequest } from "./model-gateway.ports";
import { ChatCompletionsStream } from "./chat-completions-stream";

/** Required server transport: resolve/check ALL addresses, pin chosen public IP through TLS,
 * retain hostname certificate validation, forbid redirects/proxies, bound response bytes,
 * honour AbortSignal. No fetch fallback: unconfigured safe egress fails closed.
 * This slice supplies protocol logic, not a claim that an arbitrary transport is safe. */
export interface ModelJsonTransport {
  post(request: { url: string; headers: Readonly<Record<string, string>>; body: string;
    signal: AbortSignal; maxResponseBytes: number; redirects: "error" }): Promise<{ status: number; body: string }>;
  postStream?(request: Parameters<ModelJsonTransport["post"]>[0]): AsyncIterable<
    { kind: "headers"; status: number } | { kind: "chunk"; bytes: Uint8Array }>;
}
const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string(), tool_calls: z.array(z.unknown()).optional() }),
    finish_reason: z.string().nullable().optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    completion_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).optional()
});

/** OpenAI-compatible text Chat Completions protocol. No fixed supplier or model. */
export class ChatCompletionsAdapter implements ModelAdapter {
  readonly provider = "openai_chat_completions";
  get features(): readonly ModelFeature[] { return typeof this.transport.postStream === "function" ? ["streaming"] : []; }
  constructor(private readonly transport: ModelJsonTransport) {}

  async *stream(input: Readonly<ModelRequest> & { signal: AbortSignal }, credential: string,
    connection?: Readonly<{ baseUrl: string }>): AsyncIterable<AdapterStreamEvent> {
    if (!this.transport.postStream) throw new ModelGatewayError("CAPABILITY_UNSUPPORTED");
    if (!connection || !credential.trim() || /[\r\n]/u.test(credential)) throw new ModelGatewayError("CONFIG_INVALID");
    if (input.features?.some(feature => feature !== "streaming")) throw new ModelGatewayError("CAPABILITY_UNSUPPORTED");
    const baseUrl = normalizeTenantModelBaseUrl(connection.baseUrl), decoder = new ChatCompletionsStream(credential);
    let headers = false;
    if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
    for await (const event of this.transport.postStream({ url: `${baseUrl}/chat/completions`,
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages: input.messages, stream: true, stream_options: { include_usage: true }, max_completion_tokens: input.maxOutputTokens }),
      signal: input.signal, maxResponseBytes: 1_048_576, redirects: "error" })) {
      if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
      if (event.kind === "headers") {
        if (headers) throw new ModelGatewayError("INVALID_RESPONSE"); headers = true;
        if (event.status === 401 || event.status === 403) throw new ModelAdapterError("AUTHENTICATION_FAILED");
        if (event.status === 429) throw new ModelAdapterError("RATE_LIMITED");
        if (event.status !== 200) throw new ModelAdapterError("PROVIDER_FAILED");
      } else {
        if (!headers) throw new ModelGatewayError("INVALID_RESPONSE");
        for (const delta of decoder.push(event.bytes)) yield { kind: "text_delta", delta };
      }
    }
    if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
    if (!headers) throw new ModelGatewayError("INVALID_RESPONSE");
    yield { kind: "result", result: decoder.finish() };
  }

  async generate(input: Readonly<ModelRequest> & { signal: AbortSignal }, credential: string,
    connection?: Readonly<{ baseUrl: string }>): Promise<AdapterResult> {
    if (!connection || !credential.trim() || /[\r\n]/u.test(credential)) throw new ModelGatewayError("CONFIG_INVALID");
    if (input.features?.length) throw new ModelGatewayError("CAPABILITY_UNSUPPORTED");
    const baseUrl = normalizeTenantModelBaseUrl(connection.baseUrl);
    if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
    const result = await this.transport.post({ url: `${baseUrl}/chat/completions`,
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages: input.messages, stream: false, max_completion_tokens: input.maxOutputTokens }),
      signal: input.signal, maxResponseBytes: 1_048_576, redirects: "error" });
    if (result.status === 401 || result.status === 403) throw new ModelAdapterError("AUTHENTICATION_FAILED");
    if (result.status === 429) throw new ModelAdapterError("RATE_LIMITED");
    if (result.status !== 200) throw new ModelAdapterError("PROVIDER_FAILED");
    if (typeof result.body !== "string" || Buffer.byteLength(result.body, "utf8") > 1_048_576) throw new ModelGatewayError("INVALID_RESPONSE");
    let parsed;
    try { parsed = responseSchema.safeParse(JSON.parse(result.body)); } catch { throw new ModelGatewayError("INVALID_RESPONSE"); }
    if (!parsed.success) throw new ModelGatewayError("INVALID_RESPONSE");
    const choice = parsed.data.choices[0];
    // Partial/truncated, refused or tool responses must not be presented as a complete text answer.
    if (choice.message.tool_calls?.length || choice.finish_reason !== "stop" || choice.message.content.length > 128_000 || choice.message.content.includes(credential)) throw new ModelGatewayError("INVALID_RESPONSE");
    return { text: choice.message.content, usage: parsed.data.usage ? {
      inputTokens: parsed.data.usage.prompt_tokens, outputTokens: parsed.data.usage.completion_tokens
    } : undefined };
  }
}

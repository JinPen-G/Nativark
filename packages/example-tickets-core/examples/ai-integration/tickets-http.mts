/** 工单可选AI的闭合HTTP合同、原Guard贡献与Nest适配；不启动服务或产生默认授权。
 * 公开请求只接原引用/操作键与业务输入，所有响应沿原平台信封，错误不外发存储细节。
 */
import { Body, Controller, Header, HttpCode, HttpException, Inject, Module, Param, Post, Req,
  type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { z } from "zod";
import { CoreHttpContributionSchema, CoreOpenApiContributionSchema, coreOpenApiSchema } from "@rental-os/core-contracts";
import { createTicketsHttpContribution, createTicketsOpenApi, TicketError } from "@rental-os/example-tickets-core";
import { TICKETS_AI_TASK_RESPONSES } from "@rental-os/example-tickets-core/ai-http";
import { TICKETS_AI_INPUTS, type TicketsAiAction, type TicketsAiRequests, type TicketsAiRequest } from "./tickets-application.mjs";
import { TicketsAiPolicySchema, TicketsAiPublicationReceiptSchema } from "./tickets-publication.mjs";

const responses = {
  ...TICKETS_AI_TASK_RESPONSES,
  publication: z.object({ policy: TicketsAiPolicySchema.nullable(), executionGranted: z.literal(false) }).strict(),
  publish: TicketsAiPublicationReceiptSchema,
  publicationOperation: z.object({ receipt: TicketsAiPublicationReceiptSchema.nullable(), retryable: z.literal(false), absence: z.literal("not_proof_of_no_commit") }).strict()
} satisfies Record<TicketsAiAction, z.ZodTypeAny>;
const writes = new Set<TicketsAiAction>(["publish", "prepareInput", "createTask", "prepareApproval", "decide", "execute", "observeInterrupted"]);
const historical = new Set<TicketsAiAction>(["originalInput", "originalTask", "result", "observeInterrupted"]);
const descriptions: Record<TicketsAiAction, string> = { status: "读取工单内置任务当前可用性", publication: "读取精确工具发布及累计限额",
  publish: "显式发布或停用唯一工单工具", publicationOperation: "读取原发布操作结果", prepareInput: "保存原受权工单事实",
  originalInput: "读取原操作键对应输入", createTask: "从同一原输入创建任务元数据", originalTask: "读取原输入的任务创建结果",
  prepareApproval: "计量准备原计划、步骤和待批准提案", approval: "读取原工单提案及人类决定", decide: "记录人类批准或拒绝，不执行工单",
  execute: "经原Runner执行已批准的同一工单动作", observeInterrupted: "计量观察原中断任务，不重放工具", result: "核对原任务、批准消费和工单收据" };
export const TICKETS_AI_HTTP = Object.fromEntries(Object.entries(TICKETS_AI_INPUTS).map(([name, body]) => {
  const action = name as TicketsAiAction;
  return [action, { path: `ai/${action}`, method: "POST" as const, body, response: responses[action], write: writes.has(action),
    permission: ["prepareInput", "createTask", "prepareApproval", "execute"].includes(action) ? "start" as const : "read" as const,
    purpose: historical.has(action) ? "original_receipt" as const : "business" as const, summary: descriptions[action] }];
})) as { [Action in TicketsAiAction]: { path: string; method: "POST"; body: typeof TICKETS_AI_INPUTS[Action]; response: typeof responses[Action];
  write: boolean; permission: "read" | "start"; purpose: "business" | "original_receipt"; summary: string } };
export type TicketsAiResponses = { [Action in TicketsAiAction]: z.infer<typeof responses[Action]> };

export function createTicketsAiHttpContribution() {
  const regular = createTicketsHttpContribution();
  return CoreHttpContributionSchema.parse({ ...regular, routes: [...regular.routes, ...Object.entries(TICKETS_AI_HTTP).map(([action, route]) => ({
    id: `ai.${action}`, path: `/${route.path}`, method: route.method, audiences: ["operator"],
    permissions: [{ resource: "ticket", action: route.permission }], purpose: route.purpose, startsNewBusiness: false }))] });
}
export function createTicketsAiOpenApi() {
  const document = createTicketsOpenApi(), json = (name: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${name}` } } });
  for (const [action, route] of Object.entries(TICKETS_AI_HTTP)) {
    const name = `example-tickets.ai.${action}`;
    document.schemas[`${name}.Request`] = coreOpenApiSchema(route.body);
    document.schemas[`${name}.Response`] = { type: "object", required: ["data", "requestId"], properties: {
      data: coreOpenApiSchema(route.response), requestId: { type: "string" } } };
    document.paths[`/api/cores/example-tickets/${route.path}`] = { post: { operationId: name, summary: route.summary,
      security: [{ bearerAuth: [] }], requestBody: { required: true, content: json(`${name}.Request`) },
      "x-core-permissions": [`example-tickets:ticket:${route.permission}`], "x-core-audiences": ["operator"],
      "x-core-purpose": route.purpose, "x-core-starts-new-business": false,
      description: "当前Core/对象准入及原tenant签名身份；发布另核system:params:manage，批准不授予执行权。读写均不自动重发。",
      responses: { 200: { description: "当前观察或原操作结果", content: json(`${name}.Response`) }, 400: { description: "闭合输入不符" },
        401: { description: "原会话无效" }, 403: { description: "当前权限、权益或发布不足" },
        409: { description: "依据/额度冲突或原写结果待核对，不自动重发" }, 503: { description: "原权威或原证据不可用" } } } };
  }
  return CoreOpenApiContributionSchema.parse(document);
}

export type TicketsAiHttpRequest = TicketsAiRequest & { aborted?: boolean; once?(event: "aborted", callback: () => void): unknown;
  removeListener?(event: "aborted", callback: () => void): unknown;
  res?: { once(event: "close", callback: () => void): unknown; removeListener(event: "close", callback: () => void): unknown } };
export async function withTicketsAiRequest<T>(request: TicketsAiHttpRequest, work: (signal: AbortSignal) => Promise<T>) {
  const cancellation = new AbortController(), abort = () => cancellation.abort();
  if (request.aborted) abort();
  request.once?.("aborted", abort); request.res?.once("close", abort);
  try { return await work(AbortSignal.any([cancellation.signal, AbortSignal.timeout(120000)])); }
  finally { request.removeListener?.("aborted", abort); request.res?.removeListener("close", abort); }
}
const token = Symbol("example-tickets.ai-requests");
@Controller("cores/example-tickets/ai")
class TicketsAiController {
  constructor(@Inject(token) private readonly requests: TicketsAiRequests) {}
  @Post(":action") @HttpCode(200) @Header("Cache-Control", "no-store")
  async consume(@Param("action") name: string, @Req() request: TicketsAiHttpRequest, @Body() body: unknown) {
    if (!Object.hasOwn(TICKETS_AI_HTTP, name)) throw new HttpException({ code: "AI_INVALID_INPUT", retryable: false }, 400);
    const action = name as TicketsAiAction, route = TICKETS_AI_HTTP[action];
    let called = false;
    try {
      const command = route.body.parse(body); called = true;
      return await withTicketsAiRequest(request, async signal => route.response.parse(await this.requests.consume(action, request, command, signal)));
    } catch (error) {
      if (!called && error instanceof z.ZodError) throw new HttpException({ code: "AI_INVALID_INPUT", retryable: false }, 400);
      const code = error instanceof Error && "code" in error ? error.code : null;
      const safe = error instanceof TicketError ? error.code === "denied" || error.code === "not_found" ? "AI_ACCESS_DENIED" : "AI_PROPOSAL_STALE"
        : code === "AI_ACCESS_DENIED" || code === "FORBIDDEN" ? "AI_ACCESS_DENIED"
        : code === "TICKETS_AI_BASIS_CHANGED" || code === "AI_REVISION_CONFLICT" ? "AI_PROPOSAL_STALE"
        : code === "AI_RUN_LIMIT" ? "AI_RUN_LIMIT" : route.write ? "AI_RESULT_UNKNOWN" : "AI_RESOURCE_UNAVAILABLE";
      throw new HttpException({ code: safe, retryable: false, ...(safe === "AI_RESULT_UNKNOWN" ? { nextAction: "read_original_result" } : {}) },
        safe === "AI_ACCESS_DENIED" ? 403 : safe === "AI_RESOURCE_UNAVAILABLE" ? 503 : 409);
    }
  }
}
@Module({})
export class TicketsAiHttpModule {
  static register(options: { imports?: ModuleMetadata["imports"] } & Pick<FactoryProvider<TicketsAiRequests>, "inject" | "useFactory">): DynamicModule {
    return { module: TicketsAiHttpModule, imports: options.imports ?? [], controllers: [TicketsAiController], providers: [{
      provide: token, inject: options.inject ?? [], useFactory: options.useFactory }] };
  }
}

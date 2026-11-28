/** 工单MCP同源闭合DTO、路由与OpenAPI；浏览器可用，不装配OAuth或授予权限。 */
import { z, type ZodTypeAny } from "zod";
import { coreOpenApiSchema, CoreHttpContributionSchema, CoreOpenApiContributionSchema } from "@rental-os/core-contracts";
import { createTicketsHttpContribution } from "./http";
import { createTicketsOpenApi } from "./openapi";
import { TicketAiRouteStateSchema } from "./ai-status";
import { TicketIdSchema, TicketStateSchema } from "./contracts";
const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/), revision = z.number().int().min(1).max(2147483647);
const seconds = z.number().int().positive().safe();
const clientId = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);

export const TICKETS_MCP_SCOPES = Object.freeze(["example-tickets:read", "example-tickets:receipt"] as const);
const scopes = z.array(z.enum(TICKETS_MCP_SCOPES)).min(1).max(2).refine(value => new Set(value).size === value.length);
export const TicketsMcpPolicySchema = z.object({ revision, enabled: z.boolean(), clientId, clientRevision: revision,
  resource: z.string().url().max(2048), scopes, expiresAt: seconds, fieldPolicy: z.literal("tickets-summary-v1"),
  discovery: z.object({ windowSeconds: z.number().int().min(1).max(3600), limit: z.number().int().min(1).max(1000000) }).strict() }).strict();
export const TicketsMcpPublishSchema = TicketsMcpPolicySchema.omit({ revision: true }).extend({ operationId: uuid, expectedRevision: revision.nullable() }).strict();

const registration = z.object({ clientId, enabled: z.boolean(), expiresAt: z.number().int().positive().safe(),
  redirectUris: z.array(z.string().url().max(2048)).min(1).max(20), scopes: z.array(z.enum(TICKETS_MCP_SCOPES)).min(1).max(2) }).strict();
export const TICKETS_MCP_CLIENT_INPUTS = { read: z.object({ clientId }).strict(),
  save: z.object({ operationKey: z.string().uuid(), expectedRevision: z.number().int().min(0).max(2147483646), registration }).strict(),
  operation: z.object({ clientId, operationKey: z.string().uuid() }).strict() };
export type TicketsMcpClientAction = keyof typeof TICKETS_MCP_CLIENT_INPUTS;
const saved = z.object({ state: z.literal("saved"), operationKey: z.string(), registration: registration.extend({ revision: z.number().int().positive() }).strict() }).strict();
export const TICKETS_MCP_CLIENT_RESPONSES = {
  read: z.union([z.object({ state: z.literal("not_configured") }).strict(), z.object({ state: z.literal("configured"), registration: saved.shape.registration }).strict()]),
  save: saved, operation: z.union([z.object({ state: z.literal("observed"), operationKey: z.string(), result: saved }).strict(),
    z.object({ state: z.literal("not_observed"), retryable: z.literal(false) }).strict()])
};

export const TICKETS_MCP_READ_NAMES = Object.freeze({ get: "example_tickets_get", receipt: "example_tickets_receipt" });
export const TicketsMcpReleasedFieldsSchema = z.union([
  z.object({ id: TicketIdSchema, subject: z.string().max(160), state: TicketStateSchema, revision }).strict(),
  z.object({ status: z.enum(["recorded", "unavailable"]), historicalSnapshot: z.literal(true), receipt: z.object({
    operationId: TicketIdSchema, ticket: z.object({ id: TicketIdSchema, state: TicketStateSchema, revision }).strict()
  }).strict().nullable() }).strict()
]);
const tool = z.enum([TICKETS_MCP_READ_NAMES.get, TICKETS_MCP_READ_NAMES.receipt]);
const read = z.object({ grantId: uuid, tool, input: z.union([
  z.object({ ticketId: TicketIdSchema }).strict(), z.object({ operationId: TicketIdSchema }).strict()]) }).strict();
export const TICKETS_MCP_INPUTS = {
  configuration: z.object({}).strict(), status: z.object({ ticketId: TicketIdSchema, grantId: uuid.optional() }).strict(),
  publication: z.object({ clientId: z.string().min(1).max(200) }).strict(), publish: TicketsMcpPublishSchema,
  publicationOperation: z.object({ operationId: uuid }).strict(),
  prepareConsent: z.object({ operationId: uuid, authorizationUrl: z.string().url().max(8192) }).strict(),
  consent: z.object({ consentId: uuid }).strict(),
  decide: z.object({ consentId: uuid, reviewHash: digest, decision: z.enum(["approved", "denied"]) }).strict(),
  complete: z.object({ consentId: uuid, authorizationUrl: z.string().url().max(8192) }).strict(),
  grant: z.object({ grantId: uuid }).strict(), revoke: z.object({ grantId: uuid, expectedRevision: z.number().int().min(1).max(2147483647) }).strict(),
  preview: read, authorizeRead: read.extend({ reviewHash: digest }).strict(), original: z.object({ grantId: uuid }).strict()
};
export type TicketsMcpAction = keyof typeof TICKETS_MCP_INPUTS;

const noRetry = { retryable: z.literal(false) }, noExecution = { executionGranted: z.literal(false) };
const absence = { ...noRetry, absence: z.literal("not_proof_of_no_commit") };
const consent = z.object({ id: uuid, revision, decision: z.enum(["pending", "approved", "denied"]), clientId: z.string(), resource: z.string().url(),
  scopes: z.array(z.enum(TICKETS_MCP_SCOPES)), fieldPolicy: z.literal("tickets-summary-v1"), redirectUri: z.string().url(), expiresAt: revision,
  reviewHash: digest, grantId: uuid.nullable(), ...noRetry, ...noExecution }).strict();
const publication = z.object({ operationId: uuid, commandHash: digest, policy: TicketsMcpPolicySchema }).strict();
export const TICKETS_MCP_RESPONSES = {
  configuration: z.object({ enabled: z.boolean(), resource: z.string().url(), authorizationEndpoint: z.string().url(),
    scopes: z.array(z.enum(TICKETS_MCP_SCOPES)), fieldPolicy: z.literal("tickets-summary-v1"), model: z.literal("client_paid"), ...noRetry, ...noExecution }).strict(),
  status: TicketAiRouteStateSchema,
  publication: z.object({ policy: TicketsMcpPolicySchema.nullable(), ...noExecution }).strict(), publish: publication,
  publicationOperation: z.object({ receipt: publication.nullable(), ...absence }).strict(),
  prepareConsent: consent, consent: z.object({ consent: consent.nullable(), ...absence }).strict(), decide: consent,
  complete: z.object({ callback: z.string().url().max(16384), ...noRetry }).strict(),
  grant: z.object({ grant: z.object({ id: uuid, revision, revoked: z.boolean(), expiresAt: revision, clientId: z.string(), scopes: z.array(z.enum(TICKETS_MCP_SCOPES)) }).strict().nullable(), ...absence }).strict(),
  revoke: z.object({ id: uuid, revision, revoked: z.literal(true), ...noRetry }).strict(),
  preview: z.object({ tool: TICKETS_MCP_INPUTS.preview.shape.tool, input: TICKETS_MCP_INPUTS.preview.shape.input,
    fieldPolicy: z.literal("tickets-summary-v1"), released: TicketsMcpReleasedFieldsSchema, reviewHash: digest, ...noExecution }).strict(),
  authorizeRead: z.object({ bindingKey: digest, goalId: uuid, ...noRetry, ...noExecution }).strict(),
  original: z.object({ goal: z.object({ id: uuid, revision, grantId: uuid }).strict().nullable(), budget: z.object({ revision,
    consumedCalls: z.number().int().nonnegative(), consumedActiveMs: z.number().int().nonnegative(), reservedActiveMs: z.number().int().nonnegative(),
    concurrentReads: z.number().int().nonnegative() }).strict().nullable(), calls: z.array(z.object({ callId: uuid,
      state: z.enum(["reserved", "returned", "unknown", "failed"]), activeMs: z.number().int().nonnegative().nullable(), inputHash: digest, ...noRetry }).strict()).max(20), ...absence }).strict()
} satisfies Record<TicketsMcpAction, ZodTypeAny>;
const historical = new Set<TicketsMcpAction>(["consent", "grant", "original", "revoke", "publicationOperation"]);
const writes = new Set<TicketsMcpAction>(["publish", "prepareConsent", "decide", "complete", "revoke", "authorizeRead"]);
const summaries: Record<TicketsMcpAction, string> = { configuration: "读取所选MCP路线", status: "复核当前工单MCP访问条件", publication: "读取租户客户端发布",
  publish: "显式发布或停用租户MCP读取", publicationOperation: "回读原发布结果", prepareConsent: "准备当前注册请求的人工同意",
  consent: "回读原人工同意", decide: "记录已阅授权决定", complete: "沿原AS签发一次授权回调", grant: "回读本人原授权",
  revoke: "撤回本人原授权", preview: "审核待外发工单字段", authorizeRead: "绑定已阅字段与原累计目标", original: "读取原目标及计量结果" };
interface TicketsMcpRoute { path: string; body: ZodTypeAny; response: ZodTypeAny; write: boolean; purpose: "business" | "original_receipt"; summary: string }
export const TICKETS_MCP_HTTP = Object.fromEntries(Object.keys(TICKETS_MCP_INPUTS).map((name): [TicketsMcpAction, TicketsMcpRoute] => {
  const action = name as TicketsMcpAction;
  return [action, { path: `mcp/${action.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`, body: TICKETS_MCP_INPUTS[action],
    response: TICKETS_MCP_RESPONSES[action], write: writes.has(action), purpose: historical.has(action) ? "original_receipt" as const : "business" as const, summary: summaries[action] }];
})) as Record<TicketsMcpAction, TicketsMcpRoute>;
function describe(schema: ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodEffects) return { ...describe(schema.innerType()), "x-runtime-refinement": true };
  if (schema instanceof z.ZodOptional) return describe(schema.unwrap());
  if (schema instanceof z.ZodNullable) return { anyOf: [describe(schema.unwrap()), { type: "string", nullable: true, enum: [null] }] };
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) return { anyOf: schema.options.map(describe) };
  if (schema instanceof z.ZodArray) return { ...coreOpenApiSchema(z.array(z.string())), items: describe(schema.element),
    ...(schema._def.minLength ? { minItems: schema._def.minLength.value } : {}),
    ...(schema._def.maxLength ? { maxItems: schema._def.maxLength.value } : {}) };
  if (schema instanceof z.ZodObject) {
    if (schema._def.unknownKeys !== "strict") throw new Error("MCP响应只能使用闭合对象");
    const entries = Object.entries(schema.shape) as [string, ZodTypeAny][];
    return { type: "object", additionalProperties: false, properties: Object.fromEntries(entries.map(([key, child]) => [key, describe(child)])),
      required: entries.filter(([, child]) => !(child instanceof z.ZodOptional)).map(([key]) => key) };
  }
  return coreOpenApiSchema(schema);
}
export function createTicketsMcpHttpContribution() {
  const ordinary = createTicketsHttpContribution();
  return CoreHttpContributionSchema.parse({ ...ordinary, routes: [...ordinary.routes, ...Object.values(TICKETS_MCP_HTTP).map(route => ({
    id: route.path.replace("/", "."), path: `/${route.path}`, method: "POST", audiences: ["operator"], permissions: [{ resource: "ticket", action: "read" }],
    purpose: route.purpose, startsNewBusiness: false }))] });
}
export function createTicketsMcpOpenApi() {
  const document = createTicketsOpenApi();
  for (const [action, route] of Object.entries(TICKETS_MCP_HTTP)) {
    const name = `example-tickets.mcp.${action}`, content = (suffix: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${name}.${suffix}` } } });
    document.schemas[`${name}.Request`] = describe(route.body);
    document.schemas[`${name}.Response`] = { type: "object", required: ["data", "requestId"], properties: { data: describe(route.response), requestId: { type: "string" } } };
    document.paths[`/api/cores/example-tickets/${route.path}`] = { post: { operationId: name, summary: route.summary, security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: content("Request") }, "x-core-permissions": ["example-tickets:ticket:read"], "x-core-audiences": ["operator"],
      "x-core-purpose": route.purpose, "x-core-starts-new-business": false,
      description: "原tenant Auth/Guard与同事务复权；发布另核system:params:manage。无模型依赖，不授予业务写入。所有操作禁止自动重发。",
      responses: { 200: { description: "当前观察或原结果", content: content("Response") }, 400: { description: "输入无效" }, 401: { description: "原登录无效" },
        403: { description: "当前权限或发布不足" }, 409: { description: "依据变化或原结果待核对" }, 503: { description: "当前权威不可用" } } } };
  }
  for (const action of Object.keys(TICKETS_MCP_CLIENT_INPUTS) as TicketsMcpClientAction[]) {
    const name = `example-tickets.mcp-client.${action}`;
    document.schemas[`${name}.Request`] = describe(TICKETS_MCP_CLIENT_INPUTS[action]);
    document.schemas[`${name}.Response`] = { type: "object", required: ["data", "requestId"], properties: {
      data: describe(TICKETS_MCP_CLIENT_RESPONSES[action]), requestId: { type: "string" } } };
    const content = (suffix: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${name}.${suffix}` } } });
    document.paths[`/api/cores/example-tickets/mcp-clients/${action}`] = { post: { operationId: name,
      summary: action === "save" ? "显式保存SaaS客户端注册" : action === "read" ? "读取原客户端注册" : "核对原注册操作结果",
      security: [{ bearerAuth: [] }], requestBody: { required: true, content: content("Request") },
      description: "由显式宿主登记的SaaS管理入口；原Guard、签名会话与system:params:manage同事务复权。不授予工单访问。",
      responses: { 200: { description: "原注册或原收据", content: content("Response") }, 403: { description: "当前SaaS管理权不足" },
        409: { description: "原结果待核对，不自动换键重发" }, 503: { description: "原权威不可用" } } } };
  }
  return CoreOpenApiContributionSchema.parse(document);
}

/** 显式可选的工单AI请求端口；普通Core入口不加载AI或提供默认发布/权限。 */
export { createTicketsAiRequests, TICKETS_AI_INPUTS, type TicketsAiAction, type TicketsAiRequest,
  type TicketsAiRequests } from "./tickets-application.mjs";
export { TicketsAiHttpModule, TICKETS_AI_HTTP, createTicketsAiHttpContribution, createTicketsAiOpenApi,
  withTicketsAiRequest, type TicketsAiHttpRequest, type TicketsAiResponses } from "./tickets-http.mjs";

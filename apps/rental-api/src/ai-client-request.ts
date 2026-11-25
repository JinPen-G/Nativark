/** 已通过原 Guard/selected access 的客户 AI 短请求。这里只限制同一请求的活性和
 * 对象身份；每个动作仍由原 ClientAuth、发布政策、对象权限和事务参加者核验。
 * 不建立知识会话，不授予营运权限，不在已提交结果之后追加 Core/Auth 查询。 */
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { ForbiddenException } from "@nestjs/common";
import { AI_CLIENT_ENTRY_HTTP_DRAFT } from "@rental-os/shared";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import type { RentalApplicationAccessRequest } from "@rental-os/rental-core/application-access";
import { captureRentalClientInternalAuthority } from "@rental-os/rental-core/application-internal-authority";

export interface RentalAiClientRequest extends RentalApplicationAccessRequest {
  originalUrl?: string;
  headers: { authorization?: unknown };
  staffApiRequest?: boolean;
  aborted?: boolean;
}

// The host mounts exactly these original handlers. A shared protocol addition
// cannot automatically publish another customer action in this host.
const routes = new Set([
  AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath,
  AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath
].flatMap(base => [
  AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoal,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalPreparation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalCandidates,
  AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoalQuote,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalQuotePreparation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.prepareQuoteParameters,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readQuotePreparationOperation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.confirmQuoteParameters,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readPreparedQuoteOriginal,
  AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOriginalQuoteBooking,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readOriginalQuoteBookingOperation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.issueAction,
  AI_CLIENT_ENTRY_HTTP_DRAFT.createBookingDraft,
  AI_CLIENT_ENTRY_HTTP_DRAFT.chooseBookingDraft,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingDraft,
  AI_CLIENT_ENTRY_HTTP_DRAFT.handoffBookingDraft,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingHandoff,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingOperation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingAcceptance,
  AI_CLIENT_ENTRY_HTTP_DRAFT.acceptBookingSubmission,
  AI_CLIENT_ENTRY_HTTP_DRAFT.submitAcceptedBooking,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingSubmission,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderTaskHostCapabilities,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderAction,
  AI_CLIENT_ENTRY_HTTP_DRAFT.revalidateOrderAction,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskSnapshot,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskEvents,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderExplanation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readSource,
  AI_CLIENT_ENTRY_HTTP_DRAFT.requestTaskCancellation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationReceipt,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationSettlementReceipt,
  AI_CLIENT_ENTRY_HTTP_DRAFT.settleTaskUnstartedCancellation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskInputCancellation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt,
  AI_CLIENT_ENTRY_HTTP_DRAFT.createTask,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation,
  AI_CLIENT_ENTRY_HTTP_DRAFT.startTaskModel,
  AI_CLIENT_ENTRY_HTTP_DRAFT.submitTaskInput,
  AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput,
  AI_CLIENT_ENTRY_HTTP_DRAFT.recoverTaskModel,
  AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskModel,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInput,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt,
  AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskModelResult
].map(action => `/${base}/${action}`)));
const scopes = new AsyncLocalStorage<{ active: boolean }>();
const consumed = new WeakSet<RentalAiClientRequest>();
const denied = () => new ForbiddenException("AI 客户请求已结束或与原客户请求不一致；结果须按原操作键核对");

export async function withRentalAiClientRequest<T>(request: RentalAiClientRequest,
  consume: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const sourceIdentity = getRequestIdentity(), header = request?.headers?.authorization;
  if (scopes.getStore() || !sourceIdentity || sourceIdentity.audience !== "client"
    || !request || consumed.has(request) || request.user !== undefined || request.staffApiRequest
    || typeof consume !== "function" || typeof request.method !== "string" || request.method.toUpperCase() !== "POST"
    || typeof request.url !== "string" || !routes.has(matchableRequestPath(request.url))
    || request.aborted || signal?.aborted || typeof header !== "string" || header.length > 8192
    || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header)
    || !captureRentalClientInternalAuthority(request)) throw denied();

  const identity = structuredClone(sourceIdentity), client = request.client, headers = request.headers;
  const route = { method: request.method, url: request.url, originalUrl: request.originalUrl,
    staff: request.staffApiRequest, aborted: request.aborted };
  const scope = { active: true };
  const close = () => { scope.active = false; };
  const check = () => {
    if (!scope.active || scopes.getStore() !== scope || getRequestIdentity() !== sourceIdentity
      || !isDeepStrictEqual(sourceIdentity, identity) || request.client !== client || request.user !== undefined
      || request.headers !== headers || request.headers.authorization !== header
      || request.method !== route.method || request.url !== route.url || request.originalUrl !== route.originalUrl
      || request.staffApiRequest !== route.staff || request.aborted !== route.aborted || request.aborted || signal?.aborted
      || !captureRentalClientInternalAuthority(request)) throw denied();
  };
  consumed.add(request);
  signal?.addEventListener("abort", close, { once: true });
  try {
    return await scopes.run(scope, async () => {
      check();
      const result = await consume();
      // Only owning request/ALS evidence is checked here. Current business
      // authorization remains inside the original action/transaction, so a new
      // post-commit denial cannot hide an existing material or task receipt.
      check();
      return result;
    });
  } finally {
    close();
    signal?.removeEventListener("abort", close);
  }
}

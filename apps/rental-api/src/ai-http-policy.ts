/** 可选 AI 宿主的真实处理器与提交接点。原输入、任务中心、恢复、配置和手动检查
 * 各用明确原事务；模型执行开关与客户入口不因 provider 存在而成为可调用路由。 */
import { compileRentalHttpAccessPolicy, type RentalHttpAccessDeclaration } from "@rental-os/rental-core/http-access-policy";
import { createRentalAuthorization } from "@rental-os/rental-core/http-auth";
import { StaffUploadsController } from "@rental-os/rental-core/http-staff-uploads";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import { OperatorEntrySceneCatalogController, StaffEntrySceneCatalogController } from "@rental-os/ai-native-server/runtime/scenes/entry-scene-catalog.controller";
import { StaffInspectionAssistController } from "@rental-os/ai-native-server/runtime/inspection-assist/staff-inspection-assist.controller";
import { AiOriginalScenesController, AiOriginalSceneRecoveryController,
  AI_ORIGINAL_SCENE_REQUESTS, AI_ORIGINAL_SCENE_RECOVERY_REQUESTS } from "@rental-os/ai-native-server/runtime/scenes/original-scenes.controller";
import { AiTaskCenterController, AI_NATIVE_TASK_CENTER_REQUESTS } from "@rental-os/ai-native-server/runtime/task-center.application";
import { AiModelSettingsController, AI_NATIVE_MODEL_SETTINGS_REQUESTS } from "@rental-os/ai-native-server/runtime/model-settings.application";
import { AI_STAFF_INSPECTION_REQUESTS } from "@rental-os/ai-native-server/runtime/inspection-assist/staff-inspection-assist.controller";
import * as shared from "@rental-os/shared";
import { RENTAL_HOST_CONTROLLERS } from "./http-policy";

export const RENTAL_AI_INSPECTION_OPERATIONS = Object.freeze([
  "fulfillment-receipt-read", "history-read", "receipt-host-read", "host-read", "template-read",
  "evidence-bind", "evidence-fingerprint", "draft-create", "draft-read", "draft-edit", "evidence-replace",
  "draft-operation", "submission-review", "submission-prepare", "submission-preparation", "submission-submit", "submission-read"
]);
export const RENTAL_AI_CONTROLLERS = Object.freeze([
  OperatorEntrySceneCatalogController, StaffEntrySceneCatalogController, StaffInspectionAssistController,
  AiOriginalScenesController, AiOriginalSceneRecoveryController, AiTaskCenterController, AiModelSettingsController
]);
export const RENTAL_AI_MOUNTED_REQUESTS: readonly symbol[] = Object.freeze([
  AI_STAFF_INSPECTION_REQUESTS, AI_ORIGINAL_SCENE_REQUESTS, AI_ORIGINAL_SCENE_RECOVERY_REQUESTS,
  AI_NATIVE_TASK_CENTER_REQUESTS, AI_NATIVE_MODEL_SETTINGS_REQUESTS
]);
function reviewed(controller: RentalHttpAccessDeclaration["controller"], handlers: readonly Function[],
  kind: "buffered-read" | "audited-read" | "transactional-write", evidence: string): RentalHttpAccessDeclaration[] {
  return handlers.map(handler => ({ controller, handler, review: { kind, evidence } }));
}
const scene = AiOriginalScenesController.prototype, recovery = AiOriginalSceneRecoveryController.prototype;
const center = AiTaskCenterController.prototype, settings = AiModelSettingsController.prototype;
const declarations: readonly RentalHttpAccessDeclaration[] = [
  ...reviewed(AiOriginalScenesController, [scene.queryOrders, scene.previewOrderExtension, scene.read, scene.reconcile,
    scene.reconcileReissue, scene.material, scene.materialV2, scene.sourceV2, scene.recovery,
    scene.quoteReview, scene.quoteReceipt, scene.compareOriginalQuotes], "buffered-read",
  "original frozen input/receipt and current guarded business readers; preview/material do not create quotes, tasks, leases or model calls; selected access rechecks before response"),
  ...reviewed(AiOriginalScenesController, [scene.create, scene.reissue, scene.createTask], "transactional-write",
  "original input save/reissue and task creation each retain their Serializable transaction; same Auth/Tenant/Core, original Order/Workspace and frozen input checks precede original writes and revalidate before commit; original operation keys and unknown reconciliation retained"),
  ...reviewed(AiOriginalScenesController, [scene.quoteConfirm], "transactional-write",
  "original guarded quote confirmation uses Rental Core persistQuote under same Tenant/Core/Workspace fence; frozen input/revision and original quote receipt retained, no order or payment execution"),
  ...reviewed(AiOriginalSceneRecoveryController, [recovery.readTaskPage, recovery.readTaskEvents, recovery.readTaskUsage,
    recovery.readTaskScene, recovery.readTaskPerformance, recovery.readInput, recovery.readRecoverySnapshot,
    recovery.readTakeoverReceipt, recovery.readCancellationReceipt, recovery.readCancellationSettlementReceipt,
    recovery.readAnswer], "buffered-read",
  "original persisted task/input/run/result metadata observations under current original provenance/action authority; no new runner, lease or result settlement; selected access rechecks before response"),
  ...reviewed(AiOriginalSceneRecoveryController, [recovery.readModelResult, recovery.readQuoteGoalCandidates,
    recovery.reopenModelSource, recovery.reopenOpeningModelSource], "audited-read",
  "original result/source readers retain original knowledge ACL/consent and required sensitive-read audit; host binds only that audit to original identity and same Auth/Tenant/Core short transaction; buffered response rechecks current access"),
  ...reviewed(AiOriginalSceneRecoveryController, [recovery.requestCancellationIntent, recovery.settleUnstartedCancellation,
    recovery.settleReleasedInputCancellation], "transactional-write",
  "original task transaction authority locks Auth/Tenant/Core and persisted original Order/Workspace before Task mutation; original cancellation/answer CAS and receipts remain, cancel is never proof of remote cancellation or refund"),
  ...reviewed(AiTaskCenterController, [center.list, center.snapshot, center.events, center.stopReceipt, center.usage,
    center.usageSummary, center.outcomes, center.confirmation, center.review, center.decisionReceipt, center.business,
    center.inputReceipt], "buffered-read",
  "original owner/action/provenance readers and stored confirmation/business receipts; no create/dispatch/re-admission; selected access rechecks before response"),
  ...reviewed(AiTaskCenterController, [center.result, center.source, center.performance, center.input], "audited-read",
  "original TaskCenter forwards only persisted same-task sources; optional knowledge content retains its ACL/consent and same selected sensitive audit transaction; no model start or arbitrary source access"),
  ...reviewed(AiTaskCenterController, [center.stop, center.visibleReport, center.decision, center.continue,
    center.resumeInput, center.continueInput], "transactional-write",
  "same-task transaction authority participates in original cancel/approval/input/visibility repositories, Auth/Tenant/Core then original Order/Workspace/Task; original runtime gates, approvals, idempotency and Gateway single accounting retained, unsupported provenance fails closed"),
  ...reviewed(AiModelSettingsController, [settings.read, settings.operation, settings.legacy], "buffered-read",
  "original management Guard and current same-identity configuration/legacy/operation reads; no automatic conversion, budget initialization, model or credential disclosure"),
  ...reviewed(AiModelSettingsController, [settings.save, settings.models, settings.detectProtocols], "transactional-write",
  "Scope and original config/Profile/receipt CAS each hold original Auth/Tenant/Core through final same-tx recheck; metadata discovery checks the same authority before/after its original bounded transport outside transactions; unknown config uses original operation key, no inference"),
  ...[OperatorEntrySceneCatalogController, StaffEntrySceneCatalogController].map(controller => ({ controller,
    handler: controller.prototype.read, review: { kind: "buffered-read" as const,
      evidence: "original current Auth/Guard/scope and read-only scene publication/policy metadata; actual mounted factory filter; no scope creation, task, ledger or model dispatch; same selected access rechecks before return" } })),
  { controller: StaffInspectionAssistController, handler: StaffInspectionAssistController.prototype.consume,
    review: { kind: "transactional-write", evidence: "host intersects original publication with the explicit manual operation set; original draft/evidence transactions lock current Auth Tenant/Core/Order and revalidate before commit; original submission uses same internal authority and original idempotent Core; committed/unknown receipts never re-admit or redispatch" } },
  { controller: StaffUploadsController, handler: StaffUploadsController.prototype.bindInspectionEvidence,
    review: { kind: "transactional-write", evidence: "original HTTP request credentials enter the same inspection request factory; current Auth Tenant/Core/Order and original exact asset/template/revision checks share the original evidence transaction" } }
];

export function createRentalAiHttpPolicy(authorization = createRentalAuthorization(shared)) {
  return compileRentalHttpAccessPolicy({ controllers: [...RENTAL_HOST_CONTROLLERS, ...RENTAL_AI_CONTROLLERS],
    authorization, declarations });
}

export function rentalAiRouteSelector(policy: ReturnType<typeof createRentalAiHttpPolicy>) {
  const routes = policy.routes.filter(route => RENTAL_AI_CONTROLLERS.some(controller => route.controller === controller)
    || route.controller === StaffUploadsController && route.handler === StaffUploadsController.prototype.bindInspectionEvidence);
  const patterns = routes.map(route => ({ route,
    pattern: new RegExp(`^${route.path.split("/").map(segment => segment.startsWith(":") ? "[^/]+" : segment.replace(/\./g, "\\.")).join("/")}$`, "u") }));
  return Object.freeze({
    isHandler: (controller: Function, handler: Function) => routes.some(route => route.controller === controller && route.handler === handler),
    isRoute: (request: { method: string; url: string }) => patterns.some(({ route, pattern }) =>
      route.method === request.method.toUpperCase() && pattern.test(matchableRequestPath(request.url)))
  });
}

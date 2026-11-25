/** 原三组 Controller 共用同一 Rental 台账。原提交点各自持有 Tenant/Core 围栏并保留分步回执。
 * 共享准入沿同事务成员租约复验当前角色、会话和范围，读取返回前再次复验。 */
import { JobsController } from "@rental-os/platform-server/jobs";
import { NotificationsController } from "@rental-os/platform-server/notifications";
import { IntegrationsController } from "./http-integrations.controller";
import type { RentalHttpAccessDeclaration } from "./http-access-policy";

export const RENTAL_INTEGRATION_HTTP_CONTROLLERS = Object.freeze([
  IntegrationsController, JobsController, NotificationsController
]);

const integrations = IntegrationsController.prototype;
const jobs = JobsController.prototype;
const notifications = NotificationsController.prototype;

const originalBoundaries = [
  { controller: IntegrationsController, handler: integrations.dashboard, kind: "maintained-read",
    evidence: "integration-runtime.getDashboard uses original file ACL and tenant-scoped ledgers; default templates each upsert under mysql-integrations.withLedgerMutation in its own Tenant/Core transaction" },
  { controller: IntegrationsController, handler: integrations.adapterLogs, kind: "buffered-read",
    evidence: "notification-ledger.listAdapterLogs reads original current-tenant projection without persistence or dispatch" },
  { controller: IntegrationsController, handler: integrations.dataExchangeTemplates, kind: "buffered-read",
    evidence: "integration-runtime.listDataExchangeTemplates returns original catalogue without persistence or execution" },
  { controller: IntegrationsController, handler: integrations.tboxDevices, kind: "buffered-read",
    evidence: "mysql-integrations.listTBoxDevices reads original tenantId-scoped projection without binding or update" },
  { controller: IntegrationsController, handler: integrations.mockCall, kind: "transactional-write",
    evidence: "original production refusal precedes simulated log; mysql-integrations.recordAdapterLog commits with Tenant/Core in the same RC transaction" },
  { controller: IntegrationsController, handler: integrations.createDataExchangeJob, kind: "transactional-write",
    evidence: "original createFile/createJob/recordAdapterLog each retain their separate Tenant/Core transaction; original template validation and intermediate receipts survive later log failure" },
  { controller: IntegrationsController, handler: integrations.createTBoxDevice, kind: "transactional-write",
    evidence: "mysql-integrations.saveTBoxDevice locks Tenant/Core before original device create; original later adapter log remains a separate guarded commit" },
  { controller: IntegrationsController, handler: integrations.updateTBoxDevice, kind: "transactional-write",
    evidence: "mysql-integrations.saveTBoxDevice locks Tenant/Core then reads original tenantId/id and updates the same device in one RC transaction" },
  { controller: IntegrationsController, handler: integrations.bindTBoxDevice, kind: "transactional-write",
    evidence: "mysql-integrations.bindTBoxDevice locks Tenant/Core then reads original tenantId/id and binds the same device in one RC transaction" },
  { controller: JobsController, handler: jobs.jobs, kind: "buffered-read",
    evidence: "job-ledger.listJobs reads original tenantId-scoped receipts without buildRunResult, finishJob or dispatch" },
  { controller: JobsController, handler: jobs.createJob, kind: "transactional-write",
    evidence: "mysql-integrations.createJob commits original queued receipt under Tenant/Core; original subsequent adapter log is separately guarded and its failure preserves the queued task" },
  { controller: JobsController, handler: jobs.runJob, kind: "transactional-write",
    evidence: "original buildRunResult retains simulation and file gate; mysql-integrations.finishJob reads original tenantId/id and increments original attempt with Tenant/Core in one RC transaction; later log stays separate" },
  { controller: JobsController, handler: jobs.runDueJobs, kind: "transactional-write",
    evidence: "job-ledger.runDueJobs retains original sequential queued batch and failure propagation, each run using original result/file, finishJob and log participants" },
  { controller: JobsController, handler: jobs.printJobs, kind: "buffered-read",
    evidence: "mysql-integrations.listPrintJobs reads original tenantId-scoped print receipts; absent original print participant rejects before use" },
  { controller: JobsController, handler: jobs.createPrintJob, kind: "transactional-write",
    evidence: "original createFile transaction and production refusal retained; mysql-integrations.createPrintJob guards original print row in its own Tenant/Core RC transaction; later log stays separate" },
  { controller: NotificationsController, handler: notifications.templates, kind: "maintained-read",
    evidence: "notification-ledger original default-template upserts each use mysql-integrations.withLedgerMutation, preserving historical IDs and independent Tenant/Core commits; host must revalidate before return" },
  { controller: NotificationsController, handler: notifications.logs, kind: "buffered-read",
    evidence: "notification-ledger.listNotificationLogs reads original tenantId-scoped receipts without template maintenance or dispatch" },
  { controller: NotificationsController, handler: notifications.send, kind: "transactional-write",
    evidence: "original production SMS refusal retained; mysql-integrations.recordNotification and later recordAdapterLog each commit under Tenant/Core, preserving committed notification on later failure" }
] as const;

export const RENTAL_INTEGRATION_HTTP_ACCESS: readonly RentalHttpAccessDeclaration[] = Object.freeze(
  originalBoundaries.map(({ controller, handler, kind, evidence }): RentalHttpAccessDeclaration => ({
    controller, handler, review: {
      kind,
      evidence: `${evidence}; application-access locks the original member/session/role projection in each admission transaction and revalidates the original permissions, data and location scope before commit and buffered return`
    }
  }))
);

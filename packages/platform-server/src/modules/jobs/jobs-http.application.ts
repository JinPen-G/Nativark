/** 公共作业 HTTP 沿同一台账应用读取与运行，打印由宿主按需提供原业务参加者。 */
import type { CreatePrintJobRequest, PrintJobSummary } from "@rental-os/platform-contracts/jobs";
import type { JobLedgerApplication } from "./job-ledger";

export interface PrintJobHttpApplication {
  listPrintJobs(): PromiseLike<PrintJobSummary[]>;
  createPrintJob(input: CreatePrintJobRequest): PromiseLike<PrintJobSummary>;
}

export type JobHttpApplication = Pick<JobLedgerApplication, "listJobs" | "createJob" | "runJob" | "runDueJobs">
  & Partial<PrintJobHttpApplication>;

export const JOBS_HTTP_APPLICATION = Symbol("platform.jobs.http-application");

/** 作业与打印字段沿公共合同描述，原任务、历史状态、结果和操作标签保持同源。 */
import type {
  AsyncJobSummary,
  CreateAsyncJobRequest,
  CreatePrintJobRequest,
  PrintJobSummary
} from "@rental-os/platform-contracts/jobs";
import type { JobLedgerApplication } from "./job-ledger";

type Schema = Record<string, unknown>;
const string: Schema = { type: "string" };
const date: Schema = { type: "string", format: "date-time" };
const integer: Schema = { type: "integer" };
const json: Schema = { type: "object", additionalProperties: true };
const operator: Schema = { ...string, description: "原请求的操作者标签，当前身份与权限由服务端核验。" };
const object = (properties: Record<string, Schema>, required: readonly string[], additionalProperties = false): Schema =>
  ({ type: "object", properties, required, additionalProperties });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/Jobs.${name}` });

export const JOBS_OPENAPI_SCHEMAS = {
  "Jobs.Summary": object({
    id: string, jobType: string, businessType: string, businessId: string, status: string,
    attempt: integer, maxAttempts: integer, scheduledAt: date, startedAt: date, finishedAt: date,
    operator, payload: json, result: json, createdAt: date, updatedAt: date
  } satisfies Record<keyof AsyncJobSummary, Schema>,
  ["id", "jobType", "status", "attempt", "maxAttempts", "payload", "createdAt", "updatedAt"]),
  "Jobs.List": { type: "array", items: ref("Summary") },
  "Jobs.CreateRequest": object({
    jobType: string, businessType: string, businessId: string, scheduledAt: date, payload: json, operator
  } satisfies Record<keyof CreateAsyncJobRequest, Schema>, ["jobType"], true),
  "Jobs.DueResult": object({
    ranCount: integer, jobs: { type: "array", items: ref("Summary") }, message: string
  } satisfies Record<keyof Awaited<ReturnType<JobLedgerApplication["runDueJobs"]>>, Schema>,
  ["ranCount", "jobs", "message"]),
  "Jobs.PrintSummary": object({
    id: string, documentNo: string, documentType: string, templateCode: string, businessType: string,
    businessId: string, status: string, fileAssetId: string, operator, payload: json, result: json,
    createdAt: date, updatedAt: date
  } satisfies Record<keyof PrintJobSummary, Schema>,
  ["id", "documentNo", "documentType", "templateCode", "businessType", "status", "payload", "createdAt", "updatedAt"]),
  "Jobs.PrintList": { type: "array", items: ref("PrintSummary") },
  "Jobs.CreatePrintRequest": object({
    documentType: string, templateCode: string, businessType: string, businessId: string, payload: json, operator
  } satisfies Record<keyof CreatePrintJobRequest, Schema>, ["documentType", "templateCode", "businessType"], true)
} as const;

/** 公共 AsyncJob 台账和手动运行编排。租户沿公共 ALS 读取，业务结果与运行日志由宿主执行参加者提供。 */
import { BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AsyncJobSummary, CreateAsyncJobRequest } from "@rental-os/platform-contracts/jobs";
import type { AdapterLogSummary } from "@rental-os/platform-contracts/notifications";
import { requireRequestTenantId } from "../../common/request-identity";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";

type JobJsonObject = { [key: string]: PlatformJsonValue | undefined };

export interface JobLedgerStorage {
  listJobs(tenantId: string): PromiseLike<AsyncJobSummary[]>;
  createJob(input: CreateAsyncJobRequest, tenantId: string): PromiseLike<AsyncJobSummary>;
}

export interface JobLedgerExecutionStorage {
  getJob(id: string, tenantId: string): PromiseLike<AsyncJobSummary | undefined>;
  finishJob(
    id: string,
    result: Record<string, unknown>,
    tenantId: string
  ): PromiseLike<AsyncJobSummary>;
}

/** 执行参加者返回已确认的任务结果，失败和 unknown 沿原操作向外传播。 */
export interface JobLedgerExecutionParticipants {
  storage: JobLedgerExecutionStorage;
  buildRunResult(job: AsyncJobSummary): PromiseLike<Record<string, unknown>>;
  recordRunLog(job: AsyncJobSummary): PromiseLike<unknown>;
}

export interface JobLedgerParticipants {
  storage: JobLedgerStorage;
  usePersistentStorage(): boolean;
  recordAdapterLog(input: Omit<AdapterLogSummary, "id" | "createdAt">): PromiseLike<unknown>;
  execution?: JobLedgerExecutionParticipants;
  initialJobs?: readonly AsyncJobSummary[];
  jobsByTenant?: Map<string, AsyncJobSummary[]>;
}

interface StoredAsyncJob {
  id: string;
  jobType: string;
  businessType: string | null;
  businessId: string | null;
  status: string;
  attempt: number;
  maxAttempts: number;
  scheduledAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  operator: string | null;
  payload: PlatformJsonValue;
  result: PlatformJsonValue;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobLedgerDataStore {
  asyncJob: {
    findMany(query: {
      where: { tenantId: string };
      orderBy: Array<{ status: "asc" } | { createdAt: "desc" }>;
      take: number;
    }): PromiseLike<StoredAsyncJob[]>;
    create(query: {
      data: {
        id: string;
        tenantId: string;
        jobType: string;
        businessType?: string;
        businessId?: string;
        status: "queued";
        scheduledAt: Date;
        operator?: string;
        payload: JobJsonObject;
      };
    }): PromiseLike<StoredAsyncJob>;
    findFirst?(query: {
      where: { id: string; tenantId: string };
    }): PromiseLike<StoredAsyncJob | null>;
    update?(query: {
      where: { id: string };
      data: {
        status: "success";
        attempt: { increment: number };
        startedAt: Date;
        finishedAt: Date;
        result: JobJsonObject;
      };
    }): PromiseLike<StoredAsyncJob>;
  };
}

export class JobLedgerApplication {
  private readonly jobsByTenant: Map<string, AsyncJobSummary[]>;

  constructor(private readonly participants: JobLedgerParticipants) {
    this.jobsByTenant = participants.jobsByTenant ?? new Map<string, AsyncJobSummary[]>();
  }

  async listJobs() {
    if (this.participants.usePersistentStorage()) {
      return this.participants.storage.listJobs(requireRequestTenantId());
    }
    return [...this.memoryJobsForTenant(requireRequestTenantId())];
  }

  async createJob(input: CreateAsyncJobRequest) {
    if (typeof input.jobType !== "string" || !input.jobType.trim()) {
      throw new BadRequestException("任务类型不能为空");
    }
    const job = this.participants.usePersistentStorage()
      ? await this.participants.storage.createJob(input, requireRequestTenantId())
      : this.createMemoryJob(input);

    // 原入队与日志分步写入。日志失败传播给调用方，已经登记的任务保留在原台账中。
    await this.participants.recordAdapterLog({
      provider: "mock-job-runner",
      capability: "export",
      operation: "enqueue_job",
      businessType: input.businessType,
      businessId: input.businessId,
      status: "mock_success",
      requestJson: {
        jobType: input.jobType,
        scheduledAt: job.scheduledAt
      },
      responseJson: {
        externalCallSkipped: true,
        jobId: job.id
      }
    });
    return job;
  }

  async runJob(id: string) {
    const execution = this.requireExecution();
    const existingJob = this.participants.usePersistentStorage()
      ? await execution.storage.getJob(id, requireRequestTenantId())
      : this.memoryJobsForTenant(requireRequestTenantId()).find((item) => item.id === id);

    if (!existingJob) {
      throw new BadRequestException("任务不存在");
    }

    const result = await execution.buildRunResult(existingJob);
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      throw new ServiceUnavailableException("宿主未提供有效的任务执行结果");
    }

    if (this.participants.usePersistentStorage()) {
      const job = await execution.storage.finishJob(id, result, requireRequestTenantId());
      await execution.recordRunLog(job);
      return job;
    }

    const job = existingJob;
    const now = new Date().toISOString();
    job.status = "success";
    job.attempt += 1;
    job.startedAt ||= now;
    job.finishedAt = now;
    job.result = result;
    job.updatedAt = now;
    // 原状态更新先于日志。日志失败仍保留已完成任务，后续核对使用原任务键。
    await execution.recordRunLog(job);
    return job;
  }

  async runDueJobs() {
    this.requireExecution();
    const now = Date.now();
    const jobs = await this.listJobs();
    const dueJobs = jobs.filter(
      (job) =>
        job.status === "queued" &&
        (!job.scheduledAt || new Date(job.scheduledAt).getTime() <= now)
    );
    const results = [];
    for (const job of dueJobs.slice(0, 10)) {
      results.push(await this.runJob(job.id));
    }
    return {
      ranCount: results.length,
      jobs: results,
      message: "MVP 阶段未启动常驻 worker，本接口用于手动触发到期任务。"
    };
  }

  private requireExecution() {
    const execution = this.participants.execution;
    // 先核对执行端口，避免缺完成方法时先调用业务结果回调。
    if (
      !execution ||
      !execution.storage ||
      typeof execution.storage.getJob !== "function" ||
      typeof execution.storage.finishJob !== "function" ||
      typeof execution.buildRunResult !== "function" ||
      typeof execution.recordRunLog !== "function"
    ) {
      throw new ServiceUnavailableException("宿主未提供任务执行参加者");
    }
    return execution;
  }

  private createMemoryJob(input: CreateAsyncJobRequest) {
    const tenantId = requireRequestTenantId();
    const now = new Date().toISOString();
    const row: AsyncJobSummary = {
      id: `job_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      jobType: input.jobType,
      businessType: input.businessType,
      businessId: input.businessId,
      status: "queued",
      attempt: 0,
      maxAttempts: 3,
      scheduledAt: input.scheduledAt ?? now,
      operator: input.operator,
      payload: input.payload ?? {},
      createdAt: now,
      updatedAt: now
    };
    this.memoryJobsForTenant(tenantId).unshift(row);
    return row;
  }

  private memoryJobsForTenant(tenantId: string) {
    const existing = this.jobsByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = (this.participants.initialJobs ?? []).map((item) => ({
      ...item,
      id: `${item.id}_${tenantId}`
    }));
    this.jobsByTenant.set(tenantId, seeded);
    return seeded;
  }
}

export class JobLedgerRepository implements JobLedgerStorage, JobLedgerExecutionStorage {
  constructor(private readonly dataStore: JobLedgerDataStore) {}

  async listJobs(tenantId = requireRequestTenantId()): Promise<AsyncJobSummary[]> {
    const rows = await this.dataStore.asyncJob.findMany({
      where: { tenantId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 80
    });
    return rows.map(toAsyncJobSummary);
  }

  async createJob(
    input: CreateAsyncJobRequest,
    tenantId = requireRequestTenantId()
  ): Promise<AsyncJobSummary> {
    const row = await this.dataStore.asyncJob.create({
      data: {
        id: `job_${Math.random().toString(36).slice(2, 10)}`,
        tenantId,
        jobType: input.jobType,
        businessType: input.businessType,
        businessId: input.businessId,
        status: "queued",
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : new Date(),
        operator: input.operator,
        payload: (input.payload ?? {}) as JobJsonObject
      }
    });
    return toAsyncJobSummary(row);
  }

  async getJob(
    id: string,
    tenantId = requireRequestTenantId()
  ): Promise<AsyncJobSummary | undefined> {
    const store = this.dataStore.asyncJob;
    if (!store.findFirst) {
      throw new ServiceUnavailableException("宿主未提供任务读取能力");
    }
    const row = await store.findFirst({ where: { id, tenantId } });
    return row ? toAsyncJobSummary(row) : undefined;
  }

  async finishJob(
    id: string,
    result: Record<string, unknown>,
    tenantId = requireRequestTenantId()
  ): Promise<AsyncJobSummary> {
    const store = this.dataStore.asyncJob;
    if (!store.findFirst || !store.update) {
      throw new ServiceUnavailableException("宿主未提供任务完成能力");
    }
    const existing = await store.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException(`Job ${id} was not found`);
    }
    const now = new Date();
    const row = await store.update({
      where: { id },
      data: {
        status: "success",
        attempt: { increment: 1 },
        startedAt: existing.startedAt ?? now,
        finishedAt: now,
        result: result as JobJsonObject
      }
    });
    return toAsyncJobSummary(row);
  }
}

function toAsyncJobSummary(row: StoredAsyncJob): AsyncJobSummary {
  return {
    id: row.id,
    jobType: row.jobType,
    businessType: row.businessType ?? undefined,
    businessId: row.businessId ?? undefined,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    scheduledAt: row.scheduledAt?.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    operator: row.operator ?? undefined,
    payload: jobRecordValue(row.payload),
    result: row.result ? jobRecordValue(row.result) : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function jobRecordValue(value: PlatformJsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 公共 AsyncJob 列表、创建与入队台账。租户沿公共 ALS 读取，任务执行沿宿主同一台账。 */
import { BadRequestException } from "@nestjs/common";
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

export interface JobLedgerParticipants {
  storage: JobLedgerStorage;
  usePersistentStorage(): boolean;
  recordAdapterLog(input: Omit<AdapterLogSummary, "id" | "createdAt">): PromiseLike<unknown>;
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

export class JobLedgerRepository implements JobLedgerStorage {
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

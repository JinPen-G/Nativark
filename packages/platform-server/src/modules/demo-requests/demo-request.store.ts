/** 公共平台演示预约存储端口。批量分页与身份复验共用宿主数据库，保留官方 PrismaPromise 的惰性事务语义。 */
import type { PrismaPromise, UnwrapTuple } from "@prisma/client/runtime/library";
import type { PlatformAuthDataStore, PlatformAuthTransaction } from "../platform/platform-auth-data-store";
import type { CreateDemoRequestInput, DemoRequestRow } from "@rental-os/platform-contracts/demo-request";

export type StoredDemoRequestRow = Omit<DemoRequestRow, "contactType" | "language" | "createdAt"> & {
  contactType: string; language: string; createdAt: Date;
};
type DemoRequestWhere = { OR?: Array<{ name?: { contains: string }; company?: { contains: string };
  contactValue?: { contains: string } }> };

export type DemoRequestDatabase = Omit<PlatformAuthDataStore, "$transaction"> & {
  demoRequest: {
    create(query: { data: Omit<CreateDemoRequestInput, "company" | "message"> & {
      id: string; payloadHash: string; company: string; message: string } }): PromiseLike<unknown>;
    findUnique(query: { where: { requestKey: string }; select: { payloadHash: true } }):
      PromiseLike<{ payloadHash: string } | null>;
    count(query: { where: DemoRequestWhere }): PrismaPromise<number>;
    findMany(query: { where: DemoRequestWhere; skip: number; take: number;
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]; select: { id: true; name: true; contactType: true;
        contactValue: true; company: true; message: true; language: true; createdAt: true } }): PrismaPromise<StoredDemoRequestRow[]>;
  };
  $transaction<P extends PrismaPromise<unknown>[]>(queries: [...P]): Promise<UnwrapTuple<P>>;
  $transaction<T>(work: (transaction: PlatformAuthTransaction) => Promise<T>,
    options?: { isolationLevel: "Serializable" }): Promise<T>;
};

export const DEMO_REQUEST_RATE_LIMIT = Symbol("DEMO_REQUEST_RATE_LIMIT");
/** 宿主提供原子 5 次 / 600 秒的真实桶，IP 来自其已配置可信代理的 request.ip。 */
export interface DemoRequestRateLimit {
  assertAllowed(input: { method: "POST"; path: "/public/demo-requests"; ip?: string;
    socket?: { remoteAddress?: string } }): Promise<void>;
}

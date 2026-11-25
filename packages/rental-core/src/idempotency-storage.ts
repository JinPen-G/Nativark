/** Rental 原操作收据表的私有存储视图，当前空间由原服务端来源解析。 */
import type { InputJsonValue } from "@prisma/client/runtime/library";

export interface RentalIdempotencyTransaction {
  rentalOrderIdempotencyRecord: {
    findFirst(input: {
      where: { tenantId: string; workspaceId: string; action: string; idempotencyKey: string };
    }): PromiseLike<{ requestHash: string; orderId: string | null; response: unknown; status: string } | null>;
    create(input: { data: {
      tenantId: string;
      workspaceId: string;
      action: string;
      idempotencyKey: string;
      requestHash: string;
      orderId: string | null;
      response: InputJsonValue;
    } }): PromiseLike<unknown>;
  };
}

export interface RentalIdempotencyScope<TTransaction> {
  workspaceId(tenantId: string, transaction?: TTransaction): PromiseLike<string>;
}

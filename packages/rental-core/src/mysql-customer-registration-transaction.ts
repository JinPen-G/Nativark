/** 原注册Serializable事务及有限冲突重试；其他错误原样传播，不重发外部操作。 */
import { Prisma, type PrismaClient } from "@prisma/client";

export async function customerRegistrationTransaction<T>(
  prisma: Pick<PrismaClient, "$transaction">,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code) || attempt >= 2) throw error;
    }
  }
}

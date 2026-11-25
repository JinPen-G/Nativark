/** Rental 检查的原 Guard/事务权威适配。只在真实请求中借原 Guard 返回同一
 * selected identity，再由原仓储交入它自己的事务；不包装整个 Prisma Client，
 * 不创建事务、模型调用、任务或第二业务实例。工厂存在不等于调用点已经接通。 */
import type { Prisma } from "@prisma/client";
import type { AiInspectionTarget } from "@rental-os/shared";
import { InspectionActionAuthority } from "@rental-os/ai-native-server/runtime/inspection-assist/inspection-action.authority";
import { InspectionTemplateService } from "@rental-os/ai-native-server/runtime/inspection-assist/inspection-template.service";
import type { InspectionEvidenceTransactionPorts } from "@rental-os/ai-native-server/runtime/inspection-assist/prisma-inspection-evidence.authority";
import type { InspectionDraftTransactionAuthority } from "@rental-os/ai-native-server/runtime/inspection-assist/prisma-inspection-draft.repository";

type Lease = Awaited<ReturnType<InspectionDraftTransactionAuthority["begin"]>>;
type Input = ConstructorParameters<typeof InspectionTemplateService>[0] & InspectionEvidenceTransactionPorts;
type Action = Parameters<InspectionActionAuthority["withAction"]>[1];

export function createRentalInspectionTransactions(input: Input) {
  const templates = new InspectionTemplateService(input);
  const authority = new InspectionActionAuthority(input.guard, input.credentials);
  const transactions = authority.draftTransactions({ auth: input.auth, orders: input.orders }, templates);
  return Object.freeze({
    withTarget<T>(target: AiInspectionTarget, action: Action,
      consume: (current: { begin(tx: Prisma.TransactionClient): Promise<Lease> }) => Promise<T>): Promise<T> {
      return authority.withAction(target, action, scope => consume(Object.freeze({
        // scope comes only from the just-completed original Guard, never from
        // the task DTO. begin/revalidate also reject an escaped async callback.
        begin: (tx: Prisma.TransactionClient) => transactions.begin(tx, scope)
      })));
    }
  });
}

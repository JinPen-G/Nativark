/** 只提供列表读口；原宿主须在一次受权读取内提供本租户仓储，不提供内存/恒真默认适配。 */
import type { CorePrincipal } from "@rental-os/core-contracts";
import { CORE_ID, ItemSchema, ListResponseSchema, type Item } from "./contracts";

export interface ItemReader {
  readonly tenantId: string;
  /** SQL 必须带当前租户和对象范围，按 id 排序且至多返回 limit 行。 */
  list(limit: number): Promise<readonly Item[]>;
}
export interface ItemExecution {
  /** 原身份/Core/成员/精确权限及数据就绪均由真实宿主核验，返回前复核当前授权。 */
  read<T>(principal: CorePrincipal, permission: string, work: (reader: ItemReader) => Promise<T>): Promise<T>;
}
export class ItemService {
  constructor(private readonly execution: ItemExecution) {
    if (typeof execution?.read !== "function") throw new Error("item_execution_unavailable");
  }
  async list(principal: CorePrincipal) {
    if (!principal || principal.audience !== "operator" || !principal.tenantId || !principal.subjectId)
      throw new Error("item_access_denied");
    return this.execution.read(principal, `${CORE_ID}:item:read`, async reader => {
      if (reader.tenantId !== principal.tenantId) throw new Error("item_scope_denied");
      const items = await reader.list(50);
      const projected = items.map(value => {
        const item = ItemSchema.parse(value);
        if (item.tenantId !== principal.tenantId) throw new Error("item_scope_denied");
        return { id: item.id, title: item.title };
      });
      return ListResponseSchema.parse(projected);
    });
  }
}

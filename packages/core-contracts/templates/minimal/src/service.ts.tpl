/** 条目业务与原操作回执同事务提交；未知结果只查原回执，不更换键重做。 */
import { createHash, randomUUID } from "node:crypto";
import type { CorePrincipal } from "@rental-os/core-contracts";
import { ArchiveItemSchema, CreateItemSchema, UpdateItemSchema, IdSchema, ItemError, ItemSchema, ItemViewSchema,
  ListQuerySchema, ListResponseSchema, ReceiptSchema, type Item, type ListQuery, type Permission, type Receipt } from "./contracts";

export interface StoredReceipt { operationId: string; actorId: string; fingerprint: string; item: Item }
export interface ItemRepository {
  page(query: ListQuery, ownerId: string): Promise<{ rows: Item[]; total: number }>;
  find(id: string): Promise<Item | undefined>;
  create(item: Item): Promise<void>;
  update(item: Item, expectedRevision: number): Promise<void>;
  receipt(operationId: string): Promise<StoredReceipt | undefined>;
  saveReceipt(receipt: StoredReceipt): Promise<void>;
}
export interface ItemAccess { readonly tenantId: string; readonly userId: string }
export interface ExecutionRequest { principal: CorePrincipal; permission: Permission; purpose: "business" | "original_receipt" }
export interface ItemExecution {
  /** 先核原身份/Core/成员/权限并取得授权锁，再取得业务锁；提交前复核，异常全部回滚。 */
  run<T>(request: ExecutionRequest, work: (store: ItemRepository, access: ItemAccess) => Promise<T>): Promise<T>;
}
export class ItemService {
  constructor(private readonly execution: ItemExecution, private readonly clock: () => Date = () => new Date()) {
    if (typeof execution?.run !== "function") throw new Error("item_execution_unavailable");
  }
  list(principal: CorePrincipal, input: unknown = {}) {
    const query = ListQuerySchema.parse(input);
    return this.withAccess(principal, "read", async (store, access) => {
      const page = await store.page(query, access.userId);
      return ListResponseSchema.parse({ total: page.total, rows: page.rows.map(row => this.view(this.visible(row, access))) });
    });
  }
  get(principal: CorePrincipal, itemId: string) {
    IdSchema.parse(itemId);
    return this.withAccess(principal, "read", async (store, access) => this.view(this.visible(await store.find(itemId), access)));
  }
  receipt(principal: CorePrincipal, operationId: string): Promise<{ status: "recorded"; receipt: Receipt } | { status: "unavailable" }> {
    IdSchema.parse(operationId);
    return this.withAccess(principal, "read", async (store, access) => {
      const previous = await store.receipt(operationId);
      if (!previous || previous.actorId !== access.userId) return { status: "unavailable" };
      this.visible(await store.find(previous.item.id), access);
      return { status: "recorded", receipt: ReceiptSchema.parse({ operationId, item: this.view(this.visible(previous.item, access)) }) };
    }, "original_receipt");
  }
  create(principal: CorePrincipal, input: unknown): Promise<Receipt> {
    const parsed = CreateItemSchema.parse(input);
    return this.change(principal, "create", parsed, async (store, access) => {
      const now = this.clock().toISOString();
      const item = ItemSchema.parse({ id: randomUUID(), tenantId: access.tenantId, createdBy: access.userId,
        title: parsed.title, description: parsed.description, state: "active", revision: 1, createdAt: now, updatedAt: now });
      await store.create(item); return item;
    });
  }
  update(principal: CorePrincipal, input: unknown): Promise<Receipt> {
    const parsed = UpdateItemSchema.parse(input);
    return this.change(principal, "update", parsed, (store, access) => this.edit(store, access, parsed,
      { title: parsed.title, description: parsed.description }));
  }
  archive(principal: CorePrincipal, input: unknown): Promise<Receipt> {
    const parsed = ArchiveItemSchema.parse(input);
    return this.change(principal, "archive", parsed, (store, access) => this.edit(store, access, parsed, { state: "archived" }));
  }
  private async edit(store: ItemRepository, access: ItemAccess, input: { itemId: string; expectedRevision: number },
    update: Partial<Pick<Item, "title" | "description" | "state">>) {
    const item = this.visible(await store.find(input.itemId), access);
    if (item.revision !== input.expectedRevision || item.revision >= Number.MAX_SAFE_INTEGER)
      throw new ItemError("revision_conflict", "条目已变化，请重新读取后操作");
    if (item.state !== "active") throw new ItemError("state_conflict", "已归档条目不能编辑或再次归档");
    const next = ItemSchema.parse({ ...item, ...update, revision: item.revision + 1, updatedAt: this.clock().toISOString() });
    await store.update(next, input.expectedRevision); return next;
  }
  private withAccess<T>(principal: CorePrincipal, permission: Permission,
    work: (store: ItemRepository, access: ItemAccess) => Promise<T>, purpose: ExecutionRequest["purpose"] = "business"): Promise<T> {
    if (!principal || principal.audience !== "operator" || !IdSchema.safeParse(principal.tenantId).success || !IdSchema.safeParse(principal.subjectId).success)
      return Promise.reject(new ItemError("denied", "条目仅供获权租户成员使用"));
    return this.execution.run({ principal, permission, purpose }, (store, access) => {
      if (access.tenantId !== principal.tenantId || access.userId !== principal.subjectId) throw new ItemError("denied", "事务主体与当前身份不一致");
      return work(store, access);
    });
  }
  private change<T extends { operationId: string }>(principal: CorePrincipal, permission: Exclude<Permission, "read">,
    input: T, apply: (store: ItemRepository, access: ItemAccess) => Promise<Item>): Promise<Receipt> {
    // 唯一schema固定字段顺序；同一键不能用于不同主体、动作或输入。
    const fingerprint = createHash("sha256").update(JSON.stringify([principal?.subjectId, permission, input])).digest("hex");
    return this.withAccess(principal, permission, async (store, access) => {
      const previous = await store.receipt(input.operationId);
      if (previous) {
        if (previous.actorId !== access.userId || previous.fingerprint !== fingerprint)
          throw new ItemError("operation_conflict", "原操作键对应不同请求，请核对原操作");
        this.visible(await store.find(previous.item.id), access);
        return ReceiptSchema.parse({ operationId: input.operationId, item: this.view(this.visible(previous.item, access)) });
      }
      const item = this.visible(await apply(store, access), access);
      await store.saveReceipt({ operationId: input.operationId, item, actorId: access.userId, fingerprint });
      return ReceiptSchema.parse({ operationId: input.operationId, item: this.view(item) });
    });
  }
  private visible(value: Item | undefined, access: ItemAccess): Item {
    if (!value || value.tenantId !== access.tenantId || value.createdBy !== access.userId)
      throw new ItemError("not_found", "条目不存在或不属于当前成员");
    return ItemSchema.parse(value);
  }
  private view(item: Item) { const { tenantId: _tenantId, ...view } = item; return ItemViewSchema.parse(view); }
}

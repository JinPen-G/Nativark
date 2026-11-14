/**
 * 轻量工单创建、分派、处理和关闭；同一租户内原操作回执与业务变更一起提交。
 * 宿主提供已复核Core/成员权限的事务，仓储只见本Core方法，不取得全库client。
 */
import { createHash, randomUUID } from "node:crypto";
import type { CorePrincipal } from "@rental-os/core-contracts";
import { AssignTicketSchema, ChangeTicketStateSchema, CreateTicketSchema, ListTicketsSchema, TicketError, TicketIdSchema,
  type ListTickets, type Ticket, type TicketPermission, type TicketReceipt } from "./contracts";

export interface TicketStoredReceipt extends TicketReceipt { actorId: string; fingerprint: string }
export interface TicketRepository {
  list(query: ListTickets, viewerId?: string): Promise<Ticket[]>;
  find(id: string): Promise<Ticket | undefined>;
  create(ticket: Ticket): Promise<void>;
  update(ticket: Ticket, expectedRevision: number): Promise<void>;
  receipt(operationId: string): Promise<TicketStoredReceipt | undefined>;
  saveReceipt(receipt: TicketStoredReceipt): Promise<void>;
}
export interface TicketAccess {
  readonly tenantId: string;
  readonly userId: string;
  readonly readAll: boolean;
  readonly canAssign: boolean;
  /** 宿主在Core锁之前已核对并锁定的本租户、可使用本Core的受派成员。 */
  readonly authorizedAssigneeId?: string;
}
export interface TicketExecutionRequest { principal: CorePrincipal; permission: TicketPermission; assigneeId?: string }
export interface TicketExecution {
  /**
   * 由原身份/权限所有者实现：核租户Core授权、成员分配和当前业务权限，先锁人员/授权，
   * 再串行本Core该租户的写入；业务、回执和原平台审计同事务，异常全部回滚。
   */
  run<T>(request: TicketExecutionRequest,
    work: (repository: TicketRepository, access: TicketAccess) => Promise<T>): Promise<T>;
}

export class TicketsService {
  constructor(private readonly execution: TicketExecution, private readonly clock: () => Date = () => new Date()) {}

  list(principal: CorePrincipal, input: unknown = {}): Promise<Ticket[]> {
    const query = ListTicketsSchema.parse(input);
    return this.withAccess(principal, "read", (store, access) => store.list(query, access.readAll ? undefined : access.userId));
  }

  get(principal: CorePrincipal, ticketId: string): Promise<Ticket> {
    TicketIdSchema.parse(ticketId);
    return this.withAccess(principal, "read", async (store, access) => this.visible(await store.find(ticketId), access));
  }

  create(principal: CorePrincipal, input: unknown): Promise<TicketReceipt> {
    const parsed = CreateTicketSchema.parse(input);
    return this.change(principal, "create", parsed, async (store, access) => {
      const now = this.clock().toISOString();
      const ticket: Ticket = { id: randomUUID(), tenantId: access.tenantId, subject: parsed.subject, description: parsed.description,
        createdBy: access.userId, assigneeId: null, state: "open", revision: 1, createdAt: now, updatedAt: now };
      await store.create(ticket);
      return ticket;
    });
  }

  assign(principal: CorePrincipal, input: unknown): Promise<TicketReceipt> {
    const parsed = AssignTicketSchema.parse(input);
    return this.change(principal, "assign", parsed, async (store, access) => {
      const ticket = this.visible(await store.find(parsed.ticketId), access);
      this.expected(ticket, parsed.expectedRevision);
      if (!access.canAssign) throw new TicketError("denied", "当前成员不能分派工单");
      if (ticket.state !== "open") throw new TicketError("state_conflict", "只有待处理工单可以分派");
      if (access.authorizedAssigneeId !== parsed.assigneeId) throw new TicketError("denied", "受派者不是当前租户可使用该Core的成员");
      const updated = this.next(ticket, { assigneeId: parsed.assigneeId });
      await store.update(updated, parsed.expectedRevision);
      return updated;
    }, parsed.assigneeId);
  }

  start(principal: CorePrincipal, input: unknown): Promise<TicketReceipt> {
    return this.transition(principal, "start", input, "open", "in_progress");
  }

  close(principal: CorePrincipal, input: unknown): Promise<TicketReceipt> {
    return this.transition(principal, "close", input, "in_progress", "closed");
  }

  private transition(principal: CorePrincipal, action: "start" | "close", input: unknown, from: Ticket["state"], to: Ticket["state"]): Promise<TicketReceipt> {
    const parsed = ChangeTicketStateSchema.parse(input);
    return this.change(principal, action, parsed, async (store, access) => {
      const ticket = this.visible(await store.find(parsed.ticketId), access);
      this.expected(ticket, parsed.expectedRevision);
      if (ticket.assigneeId !== access.userId && !access.canAssign) throw new TicketError("denied", "只有受派成员或管理者可以处理工单");
      if (!ticket.assigneeId || ticket.state !== from) throw new TicketError("state_conflict", "当前工单状态不支持此操作");
      const updated = this.next(ticket, { state: to });
      await store.update(updated, parsed.expectedRevision);
      return updated;
    });
  }

  private withAccess<T>(principal: CorePrincipal, permission: TicketPermission,
    work: (repository: TicketRepository, access: TicketAccess) => Promise<T>, assigneeId?: string): Promise<T> {
    if (principal.audience !== "operator") return Promise.reject(new TicketError("denied", "示范Core仅面向获权租户后台成员"));
    return this.execution.run({ principal, permission, ...(assigneeId ? { assigneeId } : {}) }, (store, access) => {
      if (access.tenantId !== principal.tenantId || access.userId !== principal.subjectId)
        throw new TicketError("denied", "工单事务身份与当前主体不一致");
      return work(store, access);
    });
  }

  private change<T extends { operationId: string }>(principal: CorePrincipal, action: Exclude<TicketPermission, "read" | "read.all">,
    input: T, apply: (store: TicketRepository, access: TicketAccess) => Promise<Ticket>, assigneeId?: string): Promise<TicketReceipt> {
    // input来自对应唯一schema，字段顺序固定；Actor/动作/业务输入共同定义同一次请求。
    const fingerprint = createHash("sha256").update(JSON.stringify([principal.subjectId, action, input])).digest("hex");
    return this.withAccess(principal, action, async (store, access) => {
      const previous = await store.receipt(input.operationId);
      if (previous) {
        if (previous.actorId !== access.userId || previous.fingerprint !== fingerprint)
          throw new TicketError("operation_conflict", "原操作键已用于不同请求，不能重放或覆盖");
        // 原收据保留历史结果，但当前角色/对象可见范围已变化时不能借重放继续读取。
        this.visible(await store.find(previous.ticket.id), access);
        if (previous.ticket.tenantId !== access.tenantId) throw new TicketError("denied", "原工单收据不属于当前租户");
        return { operationId: previous.operationId, ticket: previous.ticket };
      }
      const ticket = await apply(store, access), receipt = { operationId: input.operationId, ticket };
      await store.saveReceipt({ ...receipt, actorId: access.userId, fingerprint });
      return receipt;
    }, assigneeId);
  }

  private visible(ticket: Ticket | undefined, access: TicketAccess): Ticket {
    if (!ticket || ticket.tenantId !== access.tenantId
      || !access.readAll && ticket.createdBy !== access.userId && ticket.assigneeId !== access.userId)
      throw new TicketError("not_found", "工单不存在或不在当前可读范围");
    return ticket;
  }
  private expected(ticket: Ticket, revision: number): void {
    if (ticket.revision !== revision) throw new TicketError("revision_conflict", "工单已变化，请重新读取后操作");
  }
  private next(ticket: Ticket, update: Partial<Pick<Ticket, "assigneeId" | "state">>): Ticket {
    if (ticket.revision >= Number.MAX_SAFE_INTEGER) throw new TicketError("revision_conflict", "工单修订超出支持范围");
    return { ...ticket, ...update, revision: ticket.revision + 1, updatedAt: this.clock().toISOString() };
  }
}

import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_SCENE_REQUEST_HTTP_DRAFT,
  type AiSceneRequestCreateDraft, type AiSceneRequestReadDraft, type AiSceneTaskReceiptDraft,
  type AiSceneRequestReceiptDraft } from '@rental-os/shared';
import type { AiTaskDetailProjection } from './AiTaskWorkbench';

export type OrderAssistantQuestion = 'status' | 'fees' | 'next_steps';
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('订单事实返回不可用');
  return value as RecordValue;
};
const string = (value: unknown, max = 191): string => {
  if (typeof value !== 'string' || !value || value.length > max) throw Error('订单事实字段不可用');
  return value;
};
const statuses = new Set(['queued', 'running', 'waiting_input', 'waiting_confirmation', 'waiting_external',
  'cancel_requested', 'succeeded', 'partially_succeeded', 'failed', 'cancelled', 'unknown']);
export type OrderAssistantPacket = {
  reference: AiSceneRequestReadDraft; original: AiSceneRequestReceiptDraft;
  task: Extract<AiSceneTaskReceiptDraft, { state: 'observed' }>;
  rows: readonly { label: string; value: string }[];
};

/** Display projection only. It cannot authorize anything, compute amounts,
 * turn generated text into facts, or accept a foreign scope/order packet. */
export function projectOrderAssistantPacket(value: unknown, expected: {
  orderId: string; tenantId: string; workspaceId: string; inputRef: string; question: OrderAssistantQuestion;
}): OrderAssistantPacket {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 300000) throw Error('订单事实超过显示上限');
  const row = object(value), original = object(row.original), task = object(row.task), material = object(row.material);
  const body = object(material.payload), scope = object(body.scope), facts = object(body.facts), order = object(facts.order);
  const orderValue = object(order.value), source = object(order.source), sourceScope = object(source.scope);
  if (original.draftVersion !== AI_SCENE_REQUEST_DRAFT_VERSION || original.inputRef !== expected.inputRef
    || original.sceneCode !== 'order_explanation' || original.state !== 'stored'
    || material.version !== 'lane-a-business-content-1' || material.scenario !== 'order_explanation'
    || material.authority !== 'none_reauthorize_before_consumption' || body.status !== 'facts_only'
    || body.audience !== 'operator' || body.orderId !== expected.orderId || body.question !== expected.question
    || scope.kind !== 'workspace' || scope.tenantId !== expected.tenantId || scope.workspaceId !== expected.workspaceId
    || sourceScope.kind !== 'workspace' || sourceScope.tenantId !== expected.tenantId || sourceScope.workspaceId !== expected.workspaceId
    || source.resourceType !== 'order' || source.resourceId !== expected.orderId || orderValue.id !== expected.orderId
    || source.version !== body.orderVersion || task.state !== 'observed' || !statuses.has(String(task.status))
    || task.execution !== 'not_inferred_from_metadata' || row.model !== 'not_called') throw Error('订单事实范围或版本已变化');
  const rows = [{ label: '订单', value: expected.orderId }, { label: '当前订单状态', value: string(orderValue.status, 80) },
    { label: '观察时间', value: string(body.observedAt, 80) }, { label: '订单版本', value: string(body.orderVersion) },
    { label: '来源', value: `order:${expected.orderId} / ${string(source.field, 80)}` }];
  if (expected.question === 'fees') {
    const amounts = object(facts.amounts), amountScope = object(object(amounts.source).scope), amountSource = object(amounts.source);
    if (amounts.meaning !== 'core_order_amounts_not_payment_totals' || amountSource.resourceId !== expected.orderId
      || amountSource.version !== body.orderVersion || amountScope.kind !== 'workspace'
      || amountScope.tenantId !== expected.tenantId || amountScope.workspaceId !== expected.workspaceId) throw Error('金额来源不可用');
    const values = object(amounts.value), currency = string(amounts.currency, 3);
    if (!/^[A-Z]{3}$/u.test(currency)) throw Error('金额币种不可用');
    for (const [key, label] of Object.entries({ rental: '租金', service: '服务费', deposit: '押金',
      preAuthorization: '预授权', finalPayable: '订单应付（非实收）' })) {
      const amount = values[key];
      if (amount !== null && amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) throw Error('金额格式不可用');
      rows.push({ label, value: amount === null || amount === undefined ? '未加载' : `${amount} ${currency}` });
    }
    rows.push({ label: '原费用依据', value: string(object(facts.history).coverage, 80) },
      { label: '检查依据', value: string(object(facts.inspections).coverage, 80) });
  }
  rows.push({ label: '模型', value: '未调用；当前仅展示正式业务事实' },
    { label: '人工办理', value: '继续使用本订单页原有操作；本入口不执行退款、收款、取消或履约' });
  return { reference: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: expected.inputRef },
    original: structuredClone(original) as unknown as AiSceneRequestReceiptDraft,
    task: structuredClone(task) as unknown as OrderAssistantPacket['task'], rows };
}

/** One page/identity lifetime; no storage, timer, default read or model port.
 * An uncertain creation is observed by the ORIGINAL key, never resubmitted.
 * The server's persisted policy/entitlement remains the sole admission source.
 */
export class OrderFactsHost {
  private closed = false;
  private busy = false;
  private generation = 0;
  private readonly originals = new Map<OrderAssistantQuestion, AiSceneRequestCreateDraft>();
  constructor(private readonly input: { orderId: string; tenantId: string; workspaceId: string;
    current(): boolean; post(path: string, value: unknown): Promise<unknown>; newKey(): string }) {}
  activate() { this.closed = false; this.busy = false; this.generation++; }
  // Hide invalidates observations, not the original operation keys. Showing
  // this page must never replace an uncertain request with a new create.
  pause() { this.closed = true; this.busy = false; this.generation++; }
  close() { this.closed = true; this.generation++; this.originals.clear(); }
  private check(generation = this.generation) {
    if (this.closed || generation !== this.generation || !this.input.current()) throw Error('当前身份或订单已变化');
  }
  async read(question: OrderAssistantQuestion): Promise<OrderAssistantPacket> {
    this.check();
    if (!['status', 'fees', 'next_steps'].includes(question) || this.busy) throw Error('读取已在进行或问题不受支持');
    this.busy = true;
    const generation = this.generation;
    try {
      let command = this.originals.get(question), action: string = AI_SCENE_REQUEST_HTTP_DRAFT.reconcile;
      if (!command) {
        command = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: this.input.newKey(),
          sceneCode: 'order_explanation', input: { orderId: this.input.orderId, question } };
        this.originals.set(question, structuredClone(command)); action = '';
      }
      const path = `/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}`;
      const response = object(await this.input.post(`${path}${action ? `/${action}` : ''}`, structuredClone(command)));
      this.check(generation);
      if (!response.receipt) throw Error('原请求尚未观测；请核对原键，不会自动创建另一任务');
      const receipt = object(response.receipt);
      if (receipt.requestKey !== command.requestKey || receipt.sceneCode !== command.sceneCode
        || receipt.draftVersion !== command.draftVersion) throw Error('原请求关联不一致');
      const inputRef = string(receipt.inputRef, 36);
      const packet = await this.input.post(`${path}/${AI_SCENE_REQUEST_HTTP_DRAFT.material}`,
        { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef });
      this.check(generation);
      return projectOrderAssistantPacket(packet, { ...this.input, inputRef, question });
    } finally { if (generation === this.generation) this.busy = false; }
  }
  async detail(packet: OrderAssistantPacket, taskId: string, signal: AbortSignal): Promise<AiTaskDetailProjection> {
    const generation = this.generation;
    this.check(generation);
    const previous = structuredClone(packet);
    const selected = [...this.originals.entries()].find(([, command]) => command.requestKey === previous.original.requestKey);
    if (signal.aborted || previous.task.taskId !== taskId || !selected
      || previous.reference.inputRef !== previous.original.inputRef) throw Error('原任务详情已过期');
    // A local generation check is not current authorization. Reopen only the
    // same original material through the real Guard; never fall back to the
    // cached body after revocation, network failure or a late response.
    const raw = await this.input.post(`/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT.material}`,
      structuredClone(previous.reference));
    this.check(generation);
    if (signal.aborted) throw Error('原任务详情已过期');
    const fresh = projectOrderAssistantPacket(raw, { ...this.input, inputRef: previous.reference.inputRef, question: selected[0] });
    if (fresh.task.taskId !== taskId || fresh.original.requestKey !== previous.original.requestKey
      || fresh.original.contentHash !== previous.original.contentHash) throw Error('原请求关联已变化');
    return { task: structuredClone(fresh.task), factRows: structuredClone(fresh.rows) };
  }
}

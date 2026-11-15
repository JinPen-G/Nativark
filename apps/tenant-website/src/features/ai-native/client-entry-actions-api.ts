/** Fixed customer Action reads through the original session coordinator.
 * Order associations come from the server, not model text or browser IDs.
 * These requests neither execute business operations nor persist Actions. */
import { customerFetch, customerSessionGeneration, loadCustomerSession } from '@rental-os/web-client';
import { AI_REGISTERED_ENTRY_ACTION_VERSION, AI_REGISTERED_ENTRY_ACTION_HTTP,
  aiRegisteredEntryActionOrderSourceSchema, aiRegisteredEntryActionOrderResponseSchema,
  aiRegisteredEntryActionReadSchema, aiRegisteredEntryActionRevalidationSchema,
  type AiRegisteredEntryAction, type AiRegisteredEntryActionOrderResponse,
  type AiRegisteredEntryActionRevalidation, type ClientPaymentIntentResponse } from '@rental-os/shared';
import { API_BASE } from '../../data/apiClient';
import { captureEnterpriseHostSession } from '../../data/authClient';

const codes = ['OPEN_ORDER', 'OPEN_PROFILE', 'OPEN_PRODUCT', 'OPEN_PAYMENT'] as const;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const unavailable = () => Error('client_original_entry_unavailable');
const unwrap = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) && 'data' in value ? value.data : value;

export function captureClientEntryActionContext(tenantCode: string) {
  const host = captureEnterpriseHostSession(), session = loadCustomerSession(tenantCode), generation = customerSessionGeneration(tenantCode);
  if (!host?.current() || host.tenantCode !== tenantCode || !session?.accessToken || generation === 'unavailable'
    || session.customer.customerType !== 'personal' || session.customer.customerId !== host.customerId
    || session.workspace?.workspaceCode !== host.workspaceCode) throw unavailable();
  const token = session.accessToken, principal = JSON.stringify({ customer: session.customer, workspace: session.workspace, workspaces: session.workspaces });
  return { customerId: host.customerId, serviceCode: host.workspaceCode, current: () => {
    const now = loadCustomerSession(tenantCode);
    return host.current() && customerSessionGeneration(tenantCode) === generation && now?.accessToken === token
      && JSON.stringify({ customer: now.customer, workspace: now.workspace, workspaces: now.workspaces }) === principal;
  } };
}
type Context = ReturnType<typeof captureClientEntryActionContext>;
function originalAction(action: AiRegisteredEntryAction, context: Context, orderId: string): boolean {
  return action.contractVersion === AI_REGISTERED_ENTRY_ACTION_VERSION && action.audience === 'customer'
    && action.surface === 'tenant_website' && (codes as readonly string[]).includes(action.actionCode)
    && action.riskLevel === 'R0' && action.requiresConfirmation === false && action.associations.orderId === orderId
    && action.associations.taskId === null && action.associations.runId === null && action.associations.materialRef === null
    && action.associations.proposalId === null && action.associations.quoteId === null && action.associations.bookingDraftId === null
    && (action.actionCode !== 'OPEN_PROFILE' || action.resource.id === context.customerId)
    && (action.actionCode !== 'OPEN_ORDER' || action.resource.id === orderId);
}
export type ClientOriginalPaymentRecord = Pick<ClientPaymentIntentResponse, 'intentId' | 'instrument' | 'amount' | 'currency' | 'status' | 'expiresAt' | 'paidAt'>
  & { observedAt: string | null };
function paymentRecord(value: unknown, intentId: string, observedAt: string | null): ClientOriginalPaymentRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const row = value as Record<string, unknown>;
  if (row.intentId !== intentId || !['rental', 'deposit', 'preauthorization'].includes(String(row.instrument))
    || !['pending', 'paid', 'failed', 'funding_failed', 'closed'].includes(String(row.status))
    || typeof row.amount !== 'number' || !Number.isFinite(row.amount) || Number.isInteger(row.amount) && !Number.isSafeInteger(row.amount)
    || typeof row.currency !== 'string' || !/^[A-Z]{3}$/u.test(row.currency)
    || typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt))
    || row.paidAt !== undefined && (typeof row.paidAt !== 'string' || !Number.isFinite(Date.parse(row.paidAt)))) throw unavailable();
  return { intentId, instrument: row.instrument as ClientOriginalPaymentRecord['instrument'], amount: row.amount, currency: row.currency,
    status: row.status as ClientOriginalPaymentRecord['status'], expiresAt: row.expiresAt,
    ...(typeof row.paidAt === 'string' ? { paidAt: row.paidAt } : {}), observedAt };
}

export function createClientEntryActionApi(options: { tenantCode: string; orderId: string; current(): boolean }) {
  let skew = 0;
  const now = () => Date.now() + skew;
  const call = async (path: string, body: unknown, signal: AbortSignal) => {
    const context = captureClientEntryActionContext(options.tenantCode);
    if (!options.current() || signal.aborted) throw unavailable();
    const controller = new AbortController(), stop = () => controller.abort(), timer = setTimeout(stop, 15000);
    signal.addEventListener('abort', stop, { once: true });
    try {
      const response = await customerFetch(options.tenantCode, `${API_BASE}/api/client/v1`, path,
        { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), signal: controller.signal }, false);
      const value: unknown = await response.json();
      if (!response.ok || signal.aborted || controller.signal.aborted || !context.current() || !options.current()) throw unavailable();
      const date = response.headers.get('date'), observed = date ? Date.parse(date) : NaN;
      if (Number.isFinite(observed)) skew = observed - Date.now();
      return { context, value: unwrap(value), observedAt: Number.isFinite(observed) ? new Date(observed).toISOString() : null };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
  };
  return Object.freeze({
    now,
    async fromOrder(signal: AbortSignal): Promise<AiRegisteredEntryActionOrderResponse> {
      const command = aiRegisteredEntryActionOrderSourceSchema.parse({ orderId: options.orderId });
      const { context, value } = await call(`/${AI_REGISTERED_ENTRY_ACTION_HTTP.websiteBasePath.slice('client/v1/'.length)}/${AI_REGISTERED_ENTRY_ACTION_HTTP.fromOrder}`, command, signal);
      const result = aiRegisteredEntryActionOrderResponseSchema.parse(value);
      if (!('orderId' in result.source) || result.source.orderId !== options.orderId || result.orderId !== options.orderId
        || result.actions.length > 42 || result.actions.some(row => !originalAction(row.action, context, options.orderId)
          || !equal(row.action.scope, result.scope) || Date.parse(row.action.expiresAt) <= now())
        || result.actions.filter(row => row.action.actionCode === 'OPEN_ORDER').length !== 1
        || result.actions.filter(row => row.action.actionCode === 'OPEN_PROFILE').length > 1
        || result.actions.filter(row => row.action.actionCode === 'OPEN_PRODUCT').length > 20
        || result.actions.filter(row => row.action.actionCode === 'OPEN_PAYMENT').length > 20
        || new Set(result.actions.map(row => row.action.actionId)).size !== result.actions.length
        || new Set(result.actions.map(row => `${row.action.actionCode}:${row.action.resource.id}`)).size !== result.actions.length) throw unavailable();
      return result;
    },
    async revalidate(action: AiRegisteredEntryAction, signal: AbortSignal): Promise<AiRegisteredEntryActionRevalidation> {
      const command = aiRegisteredEntryActionReadSchema.parse({ action }), initial = captureClientEntryActionContext(options.tenantCode);
      if (!originalAction(command.action, initial, options.orderId) || Date.parse(command.action.expiresAt) <= now()) throw unavailable();
      const { context, value } = await call(`/${AI_REGISTERED_ENTRY_ACTION_HTTP.websiteBasePath.slice('client/v1/'.length)}/${AI_REGISTERED_ENTRY_ACTION_HTTP.revalidate}`, command, signal);
      const result = aiRegisteredEntryActionRevalidationSchema.parse(value);
      if (!originalAction(command.action, context, options.orderId) || Date.parse(command.action.expiresAt) <= now()
        || result.actionId !== action.actionId || result.actionCode !== action.actionCode || result.surface !== action.surface
        || result.audience !== action.audience || !equal(result.scope, action.scope) || !equal(result.resource, action.resource)
        || !equal(result.associations, action.associations)) throw unavailable();
      return result;
    },
    async readOriginalPayment(intentId: string, signal: AbortSignal): Promise<ClientOriginalPaymentRecord> {
      if (!id(options.orderId) || !id(intentId)) throw unavailable();
      const result = await call(`/orders/${encodeURIComponent(options.orderId)}/payment-intents/${encodeURIComponent(intentId)}`, undefined, signal);
      return paymentRecord(result.value, intentId, result.observedAt);
    },
  });
}

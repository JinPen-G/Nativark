/** Original customer task protocol through the canonical native contract
 * runtime and the existing authenticated HTTP client. Never replays a write. */
import { request } from '../core/http';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientOrderMaterialRequestSchema, aiClientOrderMaterialReceiptSchema,
  aiClientTaskReadRequestSchema, aiClientTaskCreationReceiptSchema, aiClientTaskModelControlResponseSchema,
  aiClientTaskModelResultReadResponseSchema, aiClientTaskInputReadResponseSchema, aiClientTaskInputSubmissionRequestSchema,
  aiClientTaskInputSubmissionReceiptSchema, aiClientTaskInputReceiptReadResponseSchema,
  aiClientTaskEventsReadRequestSchema, aiClientTaskSnapshotReadResponseSchema, aiClientTaskEventsReadResponseSchema,
  aiClientOrderActionSourceSchema, aiClientOrderActionSchema, aiClientOrderActionRevalidationSchema, aiClientHostCapabilitiesSchema } from '../vendor/shared-ai-client';
import type { AiClientHostCapabilities, AiClientOrderActionSource, AiClientOrderAction } from '@rental-os/shared';

/** Local read ports use the original public references. They are not HTTP
 * contracts, publication switches or a source of navigation authority. */
export interface ClientOrderNavigationPort {
  readHost(source: AiClientOrderActionSource): Promise<AiClientHostCapabilities>;
  readAction(source: AiClientOrderActionSource): Promise<AiClientOrderAction>;
  revalidateAction(action: AiClientOrderAction, source: AiClientOrderActionSource): Promise<AiClientOrderAction>;
}

const call = async <T>(action: string, value: unknown, schema: { parse(value: unknown): T }): Promise<T> => schema.parse(
  await request<unknown>(`/api/${AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath}/${action}`,
    { method: 'POST', data: value, replayAfterRefresh: false, timeoutMs: 15000 }));
export const clientTaskApi = Object.freeze({
  orderNavigation: Object.freeze({
    readHost(source: AiClientOrderActionSource) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderTaskHostCapabilities, aiClientOrderActionSourceSchema.parse(source), aiClientHostCapabilitiesSchema);
    },
    readAction(source: AiClientOrderActionSource) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderAction, aiClientOrderActionSourceSchema.parse(source), aiClientOrderActionSchema);
    },
    revalidateAction(action: AiClientOrderAction, source: AiClientOrderActionSource) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.revalidateOrderAction, aiClientOrderActionRevalidationSchema.parse({ ...source, action }), aiClientOrderActionSchema);
    },
  }),
  prepareMaterial(input: ReturnType<typeof aiClientOrderMaterialRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial, aiClientOrderMaterialRequestSchema.parse(input), aiClientOrderMaterialReceiptSchema);
  },
  readMaterial(input: ReturnType<typeof aiClientOrderMaterialRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt, aiClientOrderMaterialRequestSchema.parse(input), aiClientOrderMaterialReceiptSchema);
  },
  createTask(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.createTask, aiClientTaskReadRequestSchema.parse(input), aiClientTaskCreationReceiptSchema);
  },
  readCreation(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation, aiClientTaskReadRequestSchema.parse(input), aiClientTaskCreationReceiptSchema);
  },
  readSnapshot(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskSnapshot, aiClientTaskReadRequestSchema.parse(input), aiClientTaskSnapshotReadResponseSchema);
  },
  readEvents(input: ReturnType<typeof aiClientTaskEventsReadRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskEvents, aiClientTaskEventsReadRequestSchema.parse(input), aiClientTaskEventsReadResponseSchema);
  },
  startModel(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.startTaskModel, aiClientTaskReadRequestSchema.parse(input), aiClientTaskModelControlResponseSchema);
  },
  readModelResult(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskModelResult, aiClientTaskReadRequestSchema.parse(input), aiClientTaskModelResultReadResponseSchema);
  },
  readInput(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInput, aiClientTaskReadRequestSchema.parse(input), aiClientTaskInputReadResponseSchema);
  },
  submitInput(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.submitTaskInput, aiClientTaskInputSubmissionRequestSchema.parse(input), aiClientTaskInputSubmissionReceiptSchema);
  },
  readInputReceipt(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt, aiClientTaskInputSubmissionRequestSchema.parse(input), aiClientTaskInputReceiptReadResponseSchema);
  },
  continueInput(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>) {
    return call(AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput, aiClientTaskInputSubmissionRequestSchema.parse(input), aiClientTaskModelControlResponseSchema);
  },
});
export type ClientTaskApi = Omit<typeof clientTaskApi, 'orderNavigation'> & { readonly orderNavigation?: ClientOrderNavigationPort };

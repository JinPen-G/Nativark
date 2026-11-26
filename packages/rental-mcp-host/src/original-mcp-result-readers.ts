/** Bind the original result readers to the current MCP custody. No Web/DB fallback, execution or field release. */
import type { Prisma } from '@prisma/client';
import { AI_SCENE_REQUEST_DRAFT_SCHEMAS } from '@rental-os/shared';
import type { AiConversationAdmissionResponseDraft, AiSceneModelResultObservationDraft } from '@rental-os/shared';
import { createOriginalConversationResultRead } from '@rental-os/ai-native-server/runtime/original-result-reads';
import { bindRentalOriginalSaleReads, bindRentalOriginalTaskRecoveryReadIn, rentalOriginalResultComponents } from '@rental-os/ai-native-server/runtime/rental-adapters/original-result-reads';
import { validateAiSceneModelObservation } from '@rental-os/ai-native-server/runtime/scenes/scene-observation-contracts';
import { originalRequestReferenceSchema } from '@rental-os/ai-native-server/runtime/task-request/original-request.validation';
import type { createConversationResultRead } from '@rental-os/mcp-server/conversation-result-read' with { 'resolution-mode': 'import' };
import type { createOriginalTaskRecoveryRead } from '@rental-os/mcp-server/original-task-recovery-read' with { 'resolution-mode': 'import' };
import type { createQuoteSelectionRead } from '@rental-os/mcp-server/quote-selection-read' with { 'resolution-mode': 'import' };
import type { createSelectedProposalRead } from '@rental-os/mcp-server/selected-proposal-read' with { 'resolution-mode': 'import' };
import type { createSelectedOrderResultRead } from '@rental-os/mcp-server/selected-order-result-read' with { 'resolution-mode': 'import' };
import type { McpReadTool } from '@rental-os/mcp-server' with { 'resolution-mode': 'import' };
import type { OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { AiConversationTurnReferenceDraft, AiSceneRequestReadDraft } from '@rental-os/platform-contracts/ai-original-result';
import { createOriginalMcpRequestAuthority } from './original-mcp-request-authority';
import type { OriginalMcpCatalogReadContext, OriginalMcpReadSubject } from './original-mcp-read-context';

export interface OriginalMcpResultCustody {
  readonly native: Prisma.TransactionClient;
  readonly subject: OriginalMcpReadSubject;
  readonly signal: AbortSignal;
  /** Current original object/route authorization, not just a check for an open transaction. */
  assertCurrent(): Promise<void>;
}

type TaskSource = Parameters<typeof createOriginalMcpRequestAuthority>[2]
  & Pick<Parameters<typeof bindRentalOriginalTaskRecoveryReadIn>[0], 'originals' | 'clock'>;
type SaleSource = Omit<Parameters<typeof bindRentalOriginalSaleReads>[0], 'assertCurrent'>;
export interface OriginalMcpResultSources {
  conversation: {
    readAdmission(reference: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<AiConversationAdmissionResponseDraft>;
    readModelResult(reference: { original: AiSceneRequestReadDraft; resultId: string }, signal: AbortSignal): Promise<AiSceneModelResultObservationDraft>;
  };
  taskRecovery: TaskSource;
  quoteReceipt: SaleSource;
  quoteSelection: SaleSource;
  selectedProposal: SaleSource;
  selectedOrderResult: SaleSource;
}
export type OriginalMcpResultKind = keyof OriginalMcpResultSources;
export const originalMcpResultKinds: readonly OriginalMcpResultKind[] = Object.freeze([
  'conversation', 'taskRecovery', 'quoteReceipt', 'quoteSelection', 'selectedProposal', 'selectedOrderResult'
]);
export interface OriginalMcpResultReaderExports {
  createConversationResultRead: typeof createConversationResultRead;
  createOriginalTaskRecoveryRead: typeof createOriginalTaskRecoveryRead;
  createQuoteSelectionRead: typeof createQuoteSelectionRead;
  createSelectedProposalRead: typeof createSelectedProposalRead;
  createSelectedOrderResultRead: typeof createSelectedOrderResultRead;
}

type Reader = McpReadTool['read'];
type ReadScope = { custody: OriginalMcpResultCustody; call: OriginalMcpReadCallRef; context: OriginalMcpCatalogReadContext };

/** The five existing MCP validators and the original quote receipt contract stay separate from wire output. */
export function originalMcpResultTool<K extends OriginalMcpResultKind>(mcp: OriginalMcpResultReaderExports,
  kind: K, descriptor: Pick<McpReadTool, 'name' | 'description' | 'outputSchema'>,
  withReader: (read: (scope: ReadScope, command: unknown, signal: AbortSignal) => Promise<unknown>) => Reader,
  bindIn: (custody: OriginalMcpResultCustody) => Promise<OriginalMcpResultSources[K] | undefined>): McpReadTool {
  const unavailable = () => new Error('Original MCP result unavailable');
  const dispatch = async ({ custody, context, call }: ReadScope, command: unknown, signal: AbortSignal) => {
    const quote = kind === 'quoteReceipt' ? originalRequestReferenceSchema.parse(command) : undefined;
    const source = await bindIn(custody);
    await custody.assertCurrent();
    if (!source || signal.aborted) throw unavailable();
    if (kind === 'conversation') {
      const reader = source as OriginalMcpResultSources['conversation'];
      const readModelResult = reader.readModelResult.bind(reader);
      return createOriginalConversationResultRead({ assertCurrent: custody.assertCurrent,
        readAdmission: reader.readAdmission.bind(reader),
        readModelResult: async (reference, stop) => validateAiSceneModelObservation(await readModelResult(reference, stop))
      })(command, signal);
    }
    if (kind === 'taskRecovery') {
      const { originals, clock, ...policy } = source as TaskSource;
      const authority = createOriginalMcpRequestAuthority(context, call, policy, clock);
      return bindRentalOriginalTaskRecoveryReadIn({ native: custody.native, authority, originals, signal: custody.signal,
        ...(clock ? { clock } : {}) })(command, signal);
    }
    const { quote: quotes, selection, approval, task } = source as SaleSource;
    const sale = bindRentalOriginalSaleReads({ quote: quotes, selection, approval, task, assertCurrent: custody.assertCurrent });
    switch (kind) {
      case 'quoteReceipt': {
        const result = await sale.quoteReceipt(quote, signal);
        if (!quote || result.original.inputRef !== quote.inputRef || result.original.draftVersion !== quote.draftVersion
          || result.original.sceneCode !== 'quote_clarification'
          || Buffer.byteLength(JSON.stringify(result), 'utf8') > 131_072) throw unavailable();
        return result;
      }
      case 'quoteSelection': return sale.quoteSelection(command as Parameters<typeof sale.quoteSelection>[0], signal);
      case 'selectedProposal': return sale.selectedProposal(command as Parameters<typeof sale.selectedProposal>[0], signal);
      case 'selectedOrderResult': return sale.selectedOrderResult(command as Parameters<typeof sale.selectedOrderResult>[0], signal);
      default: throw unavailable();
    }
  };
  const read = withReader(dispatch);
  switch (kind) {
    case 'conversation': return mcp.createConversationResultRead({ ...descriptor,
      originalSchemas: rentalOriginalResultComponents() as Parameters<typeof createConversationResultRead>[0]['originalSchemas'], read });
    case 'taskRecovery': return mcp.createOriginalTaskRecoveryRead({ ...descriptor, read });
    case 'quoteReceipt': return { ...descriptor, inputSchema: structuredClone(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft), read };
    case 'quoteSelection': return mcp.createQuoteSelectionRead({ ...descriptor, read });
    case 'selectedProposal': return mcp.createSelectedProposalRead({ ...descriptor, read });
    case 'selectedOrderResult': return mcp.createSelectedOrderResultRead({ ...descriptor, read });
    default: throw unavailable();
  }
}

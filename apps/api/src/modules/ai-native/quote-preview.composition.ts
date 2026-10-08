import type { RentalBusinessService, BusinessContext } from "../rental-core/rental-business.service";
import type { AiExecutionContext, RentalQuoteRequest } from "@rental-os/shared";
import { AiQuotePreviewService, type AiQuotePreviewAuthority, type AiQuoteCoreContextSource } from "./quote-preview.service";

export interface AiQuotePreviewDependencies {
  core: Pick<RentalBusinessService, "createQuote">;
  context: AiQuoteCoreContextSource;
  authority: AiQuotePreviewAuthority;
  clock?: () => Date;
}

/**
 * Explicit AIN-09 composition only. It creates no Nest provider, route, worker
 * or feature flag. The authority owns authentication and the context source
 * must resolve the server-side workspace context; caller-supplied scope is not
 * accepted as a substitute.
 */
export function createAiQuotePreviewService(dependencies: AiQuotePreviewDependencies): AiQuotePreviewService {
  if (!dependencies?.core || typeof dependencies.core.createQuote !== "function") throw new Error("AI_QUOTE_PREVIEW_CORE_UNAVAILABLE");
  if (!dependencies.context || typeof dependencies.context.current !== "function") throw new Error("AI_QUOTE_PREVIEW_CONTEXT_UNAVAILABLE");
  if (!dependencies.authority || typeof dependencies.authority.withQuote !== "function") throw new Error("AI_QUOTE_PREVIEW_AUTHORITY_UNAVAILABLE");
  return new AiQuotePreviewService(dependencies.core, dependencies.context, dependencies.authority, dependencies.clock);
}

export type AiQuotePreviewContext = AiExecutionContext;
export type AiQuotePreviewCoreContext = BusinessContext;
export type AiQuotePreviewRequest = RentalQuoteRequest;

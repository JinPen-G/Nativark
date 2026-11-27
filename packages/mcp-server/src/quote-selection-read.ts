/** Compatibility import. Only the owning Rental adapter may construct this reader. */
import { originalReadOwnerUnavailable } from "./original-read-tool.js";

export function createQuoteSelectionRead(_binding: unknown): never { return originalReadOwnerUnavailable(); }

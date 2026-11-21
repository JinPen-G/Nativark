/** Explicit MCP contribution for a Rental or multi-Core host. The selected
 * source binds its real original OAuth/Auth/Guard/Native participants to this
 * Rental assembly. The ordinary host can omit the contribution entirely. */
import type { McpHttpHost } from "@rental-os/mcp-server/http-host" with { "resolution-mode": "import" };
import type { McpRoutedHost } from "@rental-os/mcp-server/host-router" with { "resolution-mode": "import" };
import type { RentalHostAssembly } from "./assembly";

export interface RentalMcpHttpSelection<Host extends RentalHostAssembly> {
  createOriginalHost(host: Host): McpRoutedHost | Promise<McpRoutedHost>;
}

export async function createRentalMcpHttpContribution<Host extends RentalHostAssembly>(
  host: Host, selection?: RentalMcpHttpSelection<Host>,
): Promise<McpHttpHost | undefined> {
  if (selection === undefined) return undefined;
  if (typeof selection?.createOriginalHost !== "function") throw new TypeError("Selected Rental MCP requires its original host");
  const createOriginalHost = selection.createOriginalHost.bind(selection);
  const { createMcpHttpHost } = await import("@rental-os/mcp-server/http-host");
  const original = await createOriginalHost(host);
  try { return createMcpHttpHost(original); }
  catch (error) {
    if (typeof original?.close === "function") {
      try { await original.close(); }
      catch (closingError) { throw new AggregateError([error, closingError], "Rental MCP construction and close failed"); }
    }
    throw error;
  }
}

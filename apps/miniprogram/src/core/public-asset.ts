import { PUBLIC_CONFIG, configProblem } from "../config/public";

/**
 * Resolve a tenant-provided public image without allowing it to escape the
 * mini-program's configured API host. API-relative `/api/...` paths are
 * resolved against the trusted API origin; arbitrary remote hosts, protocol
 * downgrade, protocol-relative URLs and path traversal fall back to no image.
 */
export function resolvePublicImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u0020\\]/u.test(candidate)) return undefined;

  const configuredOrigin = PUBLIC_CONFIG.apiOrigin.trim().replace(/\/+$/u, "");
  if (configProblem(PUBLIC_CONFIG)) return undefined;
  const originParts = /^(https?):\/\/([a-z0-9.-]+)(?::(\d+))?$/iu.exec(configuredOrigin);
  if (!originParts) return undefined;
  const [, originProtocol, originHost, originPort] = originParts;
  const normalizedOrigin = `${originProtocol.toLowerCase()}://${originHost.toLowerCase()}${originPort ? `:${originPort}` : ""}`;

  let pathAndQuery: string;
  if (candidate.startsWith("/")) {
    // Only API-owned paths are accepted. A tenant logo must be served by the
    // API or its same-origin proxy so the mini-program domain whitelist stays
    // explicit and tenant isolation remains the server's responsibility.
    if (candidate.startsWith("//") || !candidate.startsWith("/api/")) return undefined;
    pathAndQuery = candidate;
  } else {
    const absolute = /^(https?):\/\/([a-z0-9.-]+)(?::(\d+))?(\/[^\s]*)?$/iu.exec(candidate);
    if (!absolute || absolute[1].toLowerCase() !== originProtocol.toLowerCase()) return undefined;
    const [, protocol, host, port, path = "/"] = absolute;
    const candidateOrigin = `${protocol.toLowerCase()}://${host.toLowerCase()}${port ? `:${port}` : ""}`;
    if (candidateOrigin !== normalizedOrigin || !path.startsWith("/api/")) return undefined;
    pathAndQuery = path;
  }

  const pathname = pathAndQuery.split(/[?#]/u, 1)[0];
  const unsafeSegment = pathname.split("/").some((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded === "." || decoded === ".." || /[\\\u0000-\u001f\u007f]/u.test(decoded);
    } catch {
      return true;
    }
  });
  if (unsafeSegment) return undefined;
  return `${normalizedOrigin}${pathAndQuery}`;
}

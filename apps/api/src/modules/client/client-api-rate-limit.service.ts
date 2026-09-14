import { HttpException, HttpStatus, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";

export interface ClientRateLimitRequest {
  method: string;
  path: string;
  ip?: string;
  tenantId?: string;
  workspaceId?: string;
  sessionId?: string;
}

interface ClientRateLimitRule {
  code: string;
  windowSeconds: number;
  limit: number;
}

const PUBLIC_RULES: Array<{ matcher: RegExp; method?: string; rule: ClientRateLimitRule }> = [
  { matcher: /^\/client\/v1\/auth\/login$/u, method: "POST", rule: { code: "login", windowSeconds: 600, limit: 10 } },
  { matcher: /^\/client\/v1\/auth\/registration\/challenges$/u, method: "POST", rule: { code: "registration_challenge", windowSeconds: 300, limit: 5 } },
  { matcher: /^\/client\/v1\/auth\/registration\/challenges\/[^/]+\/verify$/u, method: "POST", rule: { code: "registration_verify", windowSeconds: 300, limit: 15 } },
  { matcher: /^\/client\/v1\/auth\//u, rule: { code: "public_auth", windowSeconds: 60, limit: 30 } },
  { matcher: /^\/client\/v1\/tenants\/[^/]+\/workspaces$/u, method: "GET", rule: { code: "workspace_directory", windowSeconds: 60, limit: 60 } }
];

const ANONYMOUS_RULE: ClientRateLimitRule = { code: "anonymous_client", windowSeconds: 60, limit: 180 };
const SESSION_RULE: ClientRateLimitRule = { code: "client_session", windowSeconds: 60, limit: 240 };

export function clientRateLimitRule(path: string, method: string): ClientRateLimitRule {
  const match = PUBLIC_RULES.find((entry) => entry.matcher.test(path) && (!entry.method || entry.method === method.toUpperCase()));
  return match?.rule ?? ANONYMOUS_RULE;
}

function hashScope(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedIp(ip?: string) {
  const value = ip?.trim();
  return value && value.length <= 128 ? value : "unknown";
}

@Injectable()
export class ClientApiRateLimitService implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly prisma: PrismaService) {}

  private cleanupTimer?: ReturnType<typeof setInterval>;

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === "test" || process.env.CLIENT_API_RATE_LIMIT_CLEANUP_DISABLED === "true") return;
    this.cleanupTimer = setInterval(() => {
      void this.prisma.clientApiRateBucket.deleteMany({
        where: { bucketStart: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } }
      }).catch(() => undefined);
    }, 10 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  onApplicationShutdown() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  private async increment(scopeKey: string, bucketStart: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO client_api_rate_buckets (id, scopeKey, bucketStart, count, createdAt, updatedAt)
        VALUES (${randomUUID()}, ${scopeKey}, ${bucketStart}, 1, NOW(3), NOW(3))
        ON DUPLICATE KEY UPDATE count = count + 1, updatedAt = NOW(3)
      `);
      const rows = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT \`count\` FROM \`client_api_rate_buckets\`
        WHERE \`scopeKey\` = ${scopeKey} AND \`bucketStart\` = ${bucketStart}
        LIMIT 1
      `);
      return Number(rows[0]?.count ?? 0);
    });
  }

  async assertAllowed(input: ClientRateLimitRequest): Promise<void> {
    const method = input.method.toUpperCase();
    const path = input.path.toLowerCase();
    const baseRule = clientRateLimitRule(path, method);
    const rule = input.sessionId ? SESSION_RULE : baseRule;
    const now = Date.now();
    const windowMs = rule.windowSeconds * 1000;
    const bucketStart = new Date(Math.floor(now / windowMs) * windowMs);
    const identity = input.sessionId
      ? `session:${input.tenantId ?? ""}:${input.workspaceId ?? ""}:${input.sessionId}`
      : `ip:${normalizedIp(input.ip)}`;
    const scopeKey = hashScope(`client-api:${rule.code}:${identity}`);
    const count = await this.increment(scopeKey, bucketStart);
    if (count > rule.limit) {
      throw new HttpException("客户端请求过于频繁，请稍后重试", HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

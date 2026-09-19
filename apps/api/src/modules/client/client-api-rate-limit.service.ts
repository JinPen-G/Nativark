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
  // MP-02A/02B：用途化验证码与短信/微信登录按来源地址分级限制，与既有注册/登录同量级。
  { matcher: /^\/client\/v1\/auth\/challenges$/u, method: "POST", rule: { code: "registration_challenge", windowSeconds: 300, limit: 5 } },
  { matcher: /^\/client\/v1\/auth\/sms-login$/u, method: "POST", rule: { code: "login", windowSeconds: 600, limit: 10 } },
  { matcher: /^\/client\/v1\/auth\/wechat\/phone-login$/u, method: "POST", rule: { code: "login", windowSeconds: 600, limit: 10 } },
  { matcher: /^\/client\/v1\/auth\//u, rule: { code: "public_auth", windowSeconds: 60, limit: 30 } },
  { matcher: /^\/client\/v1\/tenants\/[^/]+\/workspaces$/u, method: "GET", rule: { code: "workspace_directory", windowSeconds: 60, limit: 60 } },
  { matcher: /^\/client\/v1\/public\//u, method: "GET", rule: { code: "public_catalog", windowSeconds: 60, limit: 120 } }
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

/**
 * 限流所用的来源地址只在这里取值：直接用 Express 解析后的 `request.ip`。
 * 它是否采信 `X-Forwarded-For` 由 main.ts 的 `trust proxy`（环境变量 TRUST_PROXY_HOPS）决定，
 * 这里绝不自行读取转发头，避免客户端伪造头部换桶。
 */
export function clientAddress(request: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return normalizedIp(request.ip ?? request.socket?.remoteAddress);
}

/** 验证码挑战按目标身份与租户的额外配额；来源地址配额仍由 PUBLIC_RULES 单独执行。 */
export interface ClientChallengeQuotaInput {
  tenantId: string;
  /** 租户 + 方式 + 目标身份的不可逆哈希（与 client_registration_challenges.identifierHash 同源）。 */
  identifierHash: string;
  /** 只有走短信服务商的挑战才计入租户日预算；邮箱/开发模式不消耗。 */
  countsTowardSmsBudget: boolean;
}

const IDENTIFIER_HOURLY_RULE: ClientRateLimitRule = { code: "challenge_identifier_hour", windowSeconds: 3600, limit: 5 };
const IDENTIFIER_DAILY_RULE: ClientRateLimitRule = { code: "challenge_identifier_day", windowSeconds: 86400, limit: 10 };
const DEFAULT_TENANT_SMS_DAILY_BUDGET = 2000;

export function tenantSmsDailyBudget(): number {
  const parsed = Number.parseInt(process.env.CLIENT_SMS_DAILY_BUDGET_PER_TENANT ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TENANT_SMS_DAILY_BUDGET;
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

  private async consume(rule: ClientRateLimitRule, identity: string, now: number): Promise<number> {
    const windowMs = rule.windowSeconds * 1000;
    const bucketStart = new Date(Math.floor(now / windowMs) * windowMs);
    const scopeKey = hashScope(`client-api:${rule.code}:${identity}`);
    return this.increment(scopeKey, bucketStart);
  }

  /**
   * 验证码挑战的按身份配额：同一（租户, 目标身份）每小时 5 次、每天 10 次，
   * 另按租户统计每日短信挑战预算（默认 2000，CLIENT_SMS_DAILY_BUDGET_PER_TENANT 可调）。
   * 必须在任何服务商调用之前执行；超限与地址限流一样返回 429。
   * 计数复用 client_api_rate_buckets，桶键只保存不可逆哈希，不落手机号。
   */
  async assertChallengeAllowed(input: ClientChallengeQuotaInput): Promise<void> {
    const now = Date.now();
    const identity = `identifier:${input.tenantId}:${input.identifierHash}`;
    if (await this.consume(IDENTIFIER_HOURLY_RULE, identity, now) > IDENTIFIER_HOURLY_RULE.limit) {
      throw new HttpException("验证码请求过于频繁，请稍后重试", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (await this.consume(IDENTIFIER_DAILY_RULE, identity, now) > IDENTIFIER_DAILY_RULE.limit) {
      throw new HttpException("该手机号或邮箱今日验证码次数已达上限，请明天再试", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (input.countsTowardSmsBudget) {
      const budget: ClientRateLimitRule = { code: "tenant_sms_challenge_day", windowSeconds: 86400, limit: tenantSmsDailyBudget() };
      if (await this.consume(budget, `tenant:${input.tenantId}`, now) > budget.limit) {
        throw new HttpException("短信验证码今日发送额度已用完，请稍后重试或联系商户", HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  async assertAllowed(input: ClientRateLimitRequest): Promise<void> {
    const method = input.method.toUpperCase();
    const path = input.path.toLowerCase();
    const baseRule = clientRateLimitRule(path, method);
    const rule = input.sessionId ? SESSION_RULE : baseRule;
    const identity = input.sessionId
      ? `session:${input.tenantId ?? ""}:${input.workspaceId ?? ""}:${input.sessionId}`
      : `ip:${clientAddress({ ip: input.ip })}`;
    const count = await this.consume(rule, identity, Date.now());
    if (count > rule.limit) {
      throw new HttpException("客户端请求过于频繁，请稍后重试", HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

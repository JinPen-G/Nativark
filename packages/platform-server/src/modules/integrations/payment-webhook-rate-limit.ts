/**
 * 支付回调的进程内按 IP 令牌桶。
 *
 * 回调路由无鉴权，真正的安全边界是验签；限流只是不让伪造请求把验签
 * （RSA verify + 全租户配置解密）放大成 CPU 压力。故意不依赖
 * ClientApiRateLimitService：那条链路走数据库桶，而这里要挡的正是
 * “每个请求都碰数据库”。多实例部署时每个实例各自限流，上限按实例数放大，
 * 这对回调入口是可接受的粗粒度保护。
 *
 * PAYMENT_WEBHOOK_RATE_LIMIT_PER_MINUTE=0 关闭限流（本地联调用）。
 */
export interface WebhookRateLimitOptions {
  limitPerMinute?: number;
  /** 桶闲置多久后从 Map 移除。 */
  idleTtlMs?: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class PaymentWebhookRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limitPerMinute: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;
  private lastPruneAt = 0;

  constructor(options: WebhookRateLimitOptions = {}) {
    const fromEnv = Number(process.env.PAYMENT_WEBHOOK_RATE_LIMIT_PER_MINUTE ?? "");
    const configured = options.limitPerMinute ?? (Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 60);
    this.limitPerMinute = Math.floor(configured);
    this.idleTtlMs = options.idleTtlMs ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /** 返回 true 表示放行；false 表示应答 429。 */
  allow(ip: string | undefined): boolean {
    if (this.limitPerMinute <= 0) return true;
    const key = (ip ?? "").trim().slice(0, 128) || "unknown";
    const now = this.now();
    this.pruneIfDue(now);
    const capacity = this.limitPerMinute;
    const refillPerMs = capacity / 60_000;
    const bucket = this.buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  /** 惰性清理：每 60 秒一次，避免额外定时器；被打满的 Map 也会因为闲置 TTL 收缩。 */
  private pruneIfDue(now: number) {
    if (now - this.lastPruneAt < 60_000) return;
    this.lastPruneAt = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > this.idleTtlMs) this.buckets.delete(key);
    }
  }

  get size() {
    return this.buckets.size;
  }
}

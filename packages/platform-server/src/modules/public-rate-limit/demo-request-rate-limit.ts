/** 独立宿主的演示预约持久限流参加者。使用公共地址桶及原5次/600秒规则，事务完成后抛原429。
 * 可信代理、HTTP注册、表部署和清理生命周期由宿主管理。 */
import { HttpException, HttpStatus } from "@nestjs/common";
import type { DemoRequestRateLimit } from "../demo-requests/demo-request.store";
import { clientAddress, consumeRateLimitBucket, WEBSITE_DEMO_REQUEST_RATE_LIMIT_RULE } from "./mysql-rate-limit";
import { PLATFORM_API_RATE_LIMIT_TABLE, type SqlRateLimitStore } from "./rate-limit.store";

type DemoRequestRateLimitInput = Parameters<DemoRequestRateLimit["assertAllowed"]>[0] & {
  socket?: { remoteAddress?: string };
};

export class DemoRequestRateLimitService implements DemoRequestRateLimit {
  constructor(private readonly store: SqlRateLimitStore) {}

  async assertAllowed(input: DemoRequestRateLimitInput): Promise<void> {
    const rule = WEBSITE_DEMO_REQUEST_RATE_LIMIT_RULE;
    const count = await consumeRateLimitBucket(this.store, rule, `ip:${clientAddress(input)}`, Date.now(),
      undefined, PLATFORM_API_RATE_LIMIT_TABLE);
    // 超限也保留原尝试计数。429沿原HttpException响应，Retry-After采用原省略行为。
    if (count > rule.limit) {
      throw new HttpException("客户端请求过于频繁，请稍后重试", HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

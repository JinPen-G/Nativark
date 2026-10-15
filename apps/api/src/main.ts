/**
 * 职责：启动 Nest HTTP 应用，统一请求身份、员工路由、校验、代理和 CORS 设置。
 * 边界：业务装配见 AppModule；不能在此绕过 Guard 或直接增加业务执行路径。
 * 注意：加载本文件会执行 bootstrap 并监听端口，不能把导入它当作离线检查。
 */
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { requestIdentityMiddleware } from "./common/request-identity";
import { staffApiRoutingMiddleware } from "./common/staff-api-routing";
import { assertProductionDataSource } from "./common/production-data-source.guard";
import { apiCorsOrigins } from "./common/cors-origins";

async function bootstrap() {
  process.env.PLATFORM_DATA_SOURCE = assertProductionDataSource(process.env.NODE_ENV, process.env.PLATFORM_DATA_SOURCE);
  // 微信支付 v3 验签必须使用原始请求体；Express 解析后的 JSON 可能改变空白与字段顺序。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // 客户端限流按来源地址计数（见 client-api-rate-limit.service.ts 的 clientAddress）。
  // 部署在反向代理之后时必须声明可信跳数，否则 request.ip 永远是代理地址，
  // 全部客户端会共用一个限流桶；不设或为 0 表示直连、不信任任何 X-Forwarded-For。
  const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "0", 10);
  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) app.set("trust proxy", trustProxyHops);

  app.use(requestIdentityMiddleware);
  app.use(staffApiRoutingMiddleware);
  app.setGlobalPrefix("api");
  app.enableCors({
    credentials: true,
    origin: apiCorsOrigins(process.env.CORS_ALLOWED_ORIGINS)
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true
    })
  );

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();

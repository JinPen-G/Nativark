import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { requestIdentityMiddleware } from "./common/request-identity";

async function bootstrap() {
  // 微信支付 v3 验签必须使用原始请求体；Express 解析后的 JSON 可能改变空白与字段顺序。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // 客户端限流按来源地址计数（见 client-api-rate-limit.service.ts 的 clientAddress）。
  // 部署在反向代理之后时必须声明可信跳数，否则 request.ip 永远是代理地址，
  // 全部客户端会共用一个限流桶；不设或为 0 表示直连、不信任任何 X-Forwarded-For。
  const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "0", 10);
  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) app.set("trust proxy", trustProxyHops);

  app.use(requestIdentityMiddleware);
  app.setGlobalPrefix("api");
  app.enableCors({
    credentials: true,
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/]
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

import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { requestIdentityMiddleware } from "./common/request-identity";

async function bootstrap() {
  // 微信支付 v3 验签必须使用原始请求体；Express 解析后的 JSON 可能改变空白与字段顺序。
  const app = await NestFactory.create(AppModule, { rawBody: true });

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

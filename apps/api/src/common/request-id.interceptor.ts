import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable, map } from "rxjs";

/** 仅处理器声明的原协议响应跳过 API 信封；请求字段不能启用。 */
export const RAW_HTTP_RESPONSE = 'rental.raw-http-response';

interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
  url: string;
  requestId?: string;
}

interface HttpResponseLike {
  setHeader(name: string, value: string): void;
  getHeader?(name: string): string | number | string[] | undefined;
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();
    const incoming = request.headers["x-request-id"];
    const requestId = Array.isArray(incoming)
      ? incoming[0] ?? randomUUID()
      : incoming ?? randomUUID();

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);

    if (request.url.split("?")[0] === "/api/openapi.json"
      || Reflect.getMetadata(RAW_HTTP_RESPONSE, context.getHandler()) === true) {
      return next.handle();
    }

    return next.handle().pipe(
      map((body: unknown) => {
        if (body && typeof body === "object" && "data" in body) {
          return body;
        }

        // REPORT-01B：处理器已经显式声明了非 JSON 响应类型（如 CSV 导出）时不要包信封。
        // 包上去会把一份可下载的 CSV 变成 `{"data":"..."}`，文件打开即是乱码。
        // 判据用「已设置的 Content-Type」而不是「路径白名单」：白名单每加一个
        // 导出接口就要改这里一次，而漏改的那次只有下载文件时才会发现。
        const contentType = String(response.getHeader?.("content-type") ?? "");
        if (contentType && !contentType.includes("application/json")) {
          return body;
        }

        return {
          data: body,
          requestId
        };
      })
    );
  }
}

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable, map } from "rxjs";

interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
  url: string;
  requestId?: string;
}

interface HttpResponseLike {
  setHeader(name: string, value: string): void;
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

    if (request.url.split("?")[0] === "/api/openapi.json") {
      return next.handle();
    }

    return next.handle().pipe(
      map((body: unknown) => {
        if (body && typeof body === "object" && "data" in body) {
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

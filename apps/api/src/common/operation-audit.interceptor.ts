import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import type { SystemUserRow } from "@store-rental/shared";
import { Observable, tap } from "rxjs";
import { OperationLogService } from "./operation-log.service";

interface HttpRequestLike {
  method: string;
  url: string;
  body?: unknown;
  requestId?: string;
  user?: SystemUserRow;
}

@Injectable()
export class OperationAuditInterceptor implements NestInterceptor {
  constructor(private readonly operationLogService: OperationLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const method = request.method.toUpperCase();
    const path = this.normalizePath(request.url);

    if (this.shouldSkip(method, path)) {
      return next.handle();
    }

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          void this.operationLogService.recordHttpMutation({
            method,
            path,
            requestId: request.requestId,
            user: request.user,
            body: request.body,
            status: "success",
            durationMs: Date.now() - startedAt
          });
        },
        error: (error: { message?: string }) => {
          void this.operationLogService.recordHttpMutation({
            method,
            path,
            requestId: request.requestId,
            user: request.user,
            body: request.body,
            status: "failed",
            durationMs: Date.now() - startedAt,
            errorMessage: error?.message
          });
        }
      })
    );
  }

  private normalizePath(url: string) {
    return url.split("?")[0]?.replace(/^\/api/, "") || "/";
  }

  private shouldSkip(method: string, path: string) {
    if (method === "GET" || method === "OPTIONS") {
      return true;
    }
    if (path === "/auth/login" || path === "/health") {
      return true;
    }
    // 通用租赁域必须纳入审计：此前只放行 /platform 与 /store-rental，
    // 导致 /rental/v1 的下单、确认、配货、取消和检查全部没有审计记录，
    // RC-04「关键动作可回溯」在通用域上并不成立。
    return (
      !path.startsWith("/platform") &&
      !path.startsWith("/store-rental") &&
      !path.startsWith("/rental/")
    );
  }
}

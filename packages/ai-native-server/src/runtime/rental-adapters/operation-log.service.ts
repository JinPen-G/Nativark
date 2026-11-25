/** 原审计的窄注入端口，宿主绑定同一记录服务。 */
import type { PlatformOperationLogService } from "@rental-os/platform-server/operation-log";
export class OperationLogService {}
export interface OperationLogService extends Pick<PlatformOperationLogService, "record"> {}

/** 宿主真实挂载的 Rental Controller 集合；请求包装与旧 OpenAPI 许可共用此入口。
 * 清单来自运行模块，不读取 Core 提供的旧路径例外，也不创建业务实例或数据库连接。 */
import { RENTAL_HTTP_CONTROLLERS } from "@rental-os/rental-core/http";
import { RENTAL_PAYMENT_HTTP_CONTROLLERS } from "@rental-os/rental-core/http-payments";
import { RentalAuthExtensionsController } from "@rental-os/rental-core/http-auth-extensions";
import { StaffSubscriptionController } from "@rental-os/rental-core/http-staff-subscription";
import { RentalCustomersController } from "@rental-os/rental-core/http-customers";
import { RentalWorkspacesController } from "@rental-os/rental-core/http-workspaces";
import { IntegrationsController } from "@rental-os/rental-core/http-integrations";
import { JobsController } from "@rental-os/platform-server/jobs";
import { NotificationsController } from "@rental-os/platform-server/notifications";
import { compileRentalHttpAccessPolicy } from "@rental-os/rental-core/http-access-policy";
import { createRentalAuthorization } from "@rental-os/rental-core/http-auth";
import * as shared from "@rental-os/shared";

export const RENTAL_HOST_CONTROLLERS = Object.freeze([...RENTAL_HTTP_CONTROLLERS, ...RENTAL_PAYMENT_HTTP_CONTROLLERS,
  RentalAuthExtensionsController, StaffSubscriptionController, RentalCustomersController, RentalWorkspacesController,
  IntegrationsController, JobsController, NotificationsController]);

export function createRentalHostHttpPolicy(authorization = createRentalAuthorization(shared)) {
  return compileRentalHttpAccessPolicy({ controllers: RENTAL_HOST_CONTROLLERS, authorization, inspectionEvidence: "unavailable" });
}

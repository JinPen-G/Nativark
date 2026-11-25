/** 原 Guard 的注入契约；宿主只绑定同一已构造 Guard，不从 AI 凭据创建第二实例。 */
import * as contracts from "@rental-os/shared";
import { createRentalAuthorization } from "@rental-os/rental-core/http-auth";
const authorization = createRentalAuthorization(contracts);
export const ApiAuthGuard: ReturnType<typeof createRentalAuthorization>["Guard"] = authorization.Guard;
export type ApiAuthGuard = InstanceType<typeof ApiAuthGuard>;

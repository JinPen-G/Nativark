/** Explicit recipient refusal of an original unresolved transfer decision; no authority inputs. */
import { IsBoolean, IsIn } from "class-validator";
import type { CloseEnterpriseTransferDecisionRequest } from "./index";
import { EnterpriseChangeRequestDto } from "./http-enterprise-request.dto";
export class CloseEnterpriseTransferDecisionDto extends EnterpriseChangeRequestDto implements CloseEnterpriseTransferDecisionRequest {
  @IsBoolean() @IsIn([true]) confirm!: true;
}

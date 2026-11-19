import { IsIn, IsString, MaxLength } from "class-validator";
import type { ReviewPaymentStatementLineRequest } from "./payment-contracts";

export class ReviewPaymentStatementLineDto implements ReviewPaymentStatementLineRequest {
  @IsIn(["acknowledge", "query_provider"])
  decision!: "acknowledge" | "query_provider";

  @IsString()
  @MaxLength(500)
  reason!: string;
}

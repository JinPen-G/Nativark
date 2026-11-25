/** 员工线下收款的请求、公开登记和确认收据。字段沿原 DTO、服务投影和资金事件，当前准入由原服务裁定。 */
import type { CreateStaffOfflinePaymentRequest } from "./contracts";
import type { StaffOfflinePaymentService } from "./mysql-staff-payments";
import { objectOf, ref, stringSchema, type SchemaObject } from "./http-openapi-contract";

type StaffPaymentRegistration = Awaited<ReturnType<StaffOfflinePaymentService["register"]>>;
type StaffPaymentConfirmation = Awaited<ReturnType<StaffOfflinePaymentService["confirm"]>>;

export const RENTAL_PAYMENT_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  CreateStaffOfflinePaymentRequest: {
    ...objectOf({
      orderId: { type: "string", minLength: 1, pattern: "\\S", description: "原登记入口去除首尾空白，按当前租户、经营空间和员工地点核验订单。" },
      instrument: { type: "string", enum: ["rental", "deposit"], description: "原线下登记支持租金和押金，分别沿所属资金科目核验可收额度。" },
      amount: { type: "number", minimum: 0.01, multipleOf: 0.01, description: "原 DTO 接受最多两位小数的正金额，原资金服务在登记与确认时核验可收额度。" },
      paymentMethod: { type: "string", enum: ["offline_cash", "offline_transfer"], description: "原线下现金或转账方式，新登记沿原事务核验当前空间已启用方式。" },
      reason: { type: "string", minLength: 1, maxLength: 500, pattern: "\\S" },
      idempotencyKey: { type: "string", minLength: 1, maxLength: 191, pattern: "\\S", description: "原订单内登记幂等键。原入口去除首尾空白，相同键须对应同一款项、金额、方式、用途和凭证。" },
      evidenceFileAssetId: { type: "string", maxLength: 191, nullable: true, description: "可省略或 null，原服务核验已完成上传且绑定本订单的线下收款凭证。" }
    } satisfies Record<keyof CreateStaffOfflinePaymentRequest, SchemaObject>, [
      "orderId", "instrument", "amount", "paymentMethod", "reason", "idempotencyKey"
    ]),
    description: "原 CreateStaffOfflinePaymentDto。登记保存待确认记录并占用待收额度，确认沿原登记和资金事务办理。",
    example: {
      orderId: "order_example",
      instrument: "rental",
      amount: 100,
      paymentMethod: "offline_transfer",
      reason: "线下银行转账",
      idempotencyKey: "offline-registration-example"
    }
  },
  StaffOfflinePaymentRegistration: {
    ...objectOf({
      id: stringSchema,
      orderId: stringSchema,
      instrument: { type: "string", enum: ["rental", "deposit"] },
      amount: { type: "number", description: "原登记金额，按保存值返回。" },
      paymentMethod: { type: "string", enum: ["offline_cash", "offline_transfer"] },
      reason: stringSchema,
      evidenceFileAssetId: stringSchema,
      status: { type: "string", enum: ["pending", "confirmed"] },
      registeredBy: stringSchema,
      registeredAt: { type: "string", format: "date-time" },
      confirmedBy: stringSchema,
      confirmedAt: { type: "string", format: "date-time" },
      fundingEventId: { type: "string", description: "已确认登记关联的原资金事件 ID。原空值省略，原确认入口核验收据一致性。" }
    } satisfies Record<keyof StaffPaymentRegistration, SchemaObject>, [
      "id", "orderId", "instrument", "amount", "paymentMethod", "reason", "status", "registeredAt"
    ], false),
    description: "原登记公开投影。凭证、登记人、确认人、确认时间及资金事件 ID 的存储空值沿原映射省略。列表为最多 50 条的原登记数组，按登记时间倒序返回。",
    example: {
      id: "registration_example",
      orderId: "order_example",
      instrument: "rental",
      amount: 100,
      paymentMethod: "offline_transfer",
      reason: "线下银行转账",
      status: "pending",
      registeredAt: "2026-01-01T01:00:00.000Z"
    }
  },
  StaffOfflinePaymentConfirmation: {
    ...objectOf({
      registration: ref("StaffOfflinePaymentRegistration"),
      fundingEvent: ref("RentalFundingEvent")
    } satisfies Record<keyof StaffPaymentConfirmation, SchemaObject>, ["registration", "fundingEvent"], false),
    description: "原确认结果，在同一事务内关联已确认登记和原资金事件。重复确认沿原登记核验同一事件、幂等键、款项、金额和 offline 来源，再返回原收据。"
  }
};

# 员工会员审核客户端

`createRentalStaffReviewsApi` 提供会员注册与证件审核的列表读取和审核决策。业务类型引用 Rental 合同，真实员工宿主传入原 `request`，旧 API 入口持有一组实例并导出两个原方法。[审核工厂](../reviews.ts) · [Rental 合同](../../../src/contracts.ts) · [宿主薄入口](../../../../../apps/staff-miniprogram/src/api/reviews.ts)

## 接入与请求

```ts
import { createRentalStaffReviewsApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";

const reviews = createRentalStaffReviewsApi({ request });
const rows = await reviews.listMembershipReviews({ status: "pending", type: "registration" });
```

`listMembershipReviews(query?)` 使用 `/membership/reviews`，查询字段沿用 `status` 与 `type`。`decideMembershipReview(reviewId, input)` 分别编码审核 ID，以 POST 将原 input 投递到 `/membership/reviews/.../decision`。两项均使用原 `tenant` 范围，由运输拼接 `/api/staff/v1` 员工门面并供给原会话鉴权。[请求端口](../ports.ts) · [员工运输](../../../../../apps/staff-miniprogram/src/core/http.ts) · [员工门面](../../../../../apps/api/src/common/staff-api-routing.ts)

两个方法返回原请求 Promise。错误、超时及失应答结果沿原运输和业务域处理，当前审核状态由原会员服务读取和裁定。[审核工厂](../reviews.ts) · [会员 HTTP](../../../src/http-membership.controller.ts)

## 权限与直接消费者

员工审核页面使用原 `canTenant()` 和租户级 `dataScope=all` 判断入口与动作。注册审核使用 `rental-os:member:review`，证件审核使用 `rental-os:member:qualification-review`，服务端按当前角色分别校验。审核列表、详情面板、确认与原因输入、附件展示及加载反馈由原页面处理。[审核页面](../../../../../apps/staff-miniprogram/src/pages/reviews/index.ts) · [员工会话](../../../../../apps/staff-miniprogram/src/core/session.ts) · [员工门面政策](../../../../../apps/api/src/common/staff-api-policy.ts) · [会员 HTTP](../../../src/http-membership.controller.ts)

工作台沿原审核权限读取待处理数量，读取失败时按原页面逻辑提供审核入口。[工作台消费者](../../../../../apps/staff-miniprogram/src/pages/workbench/index.ts)

调用链为员工审核页面或工作台 → 原 API 薄入口 → 本工厂 → 原员工运输 → 员工白名单门面 → 会员 HTTP → 同一会员应用与存储/事务参加者。[会员应用接点](../../../src/http-membership-applications.ts) · [会员服务](../../../src/mysql-membership.ts) · [存储与参加者](../../../src/membership-ports.ts)

## 验证

必要类型检查覆盖工厂、薄入口与原审核页面。定向冒烟复用既有员工宿主替身及租户权限断言，核对两项原方法签名、查询、ID 编码、POST 负载和原错误传播。微信发布包、真机与真实业务服务沿原入口分别验收。[既有员工测试](../../../../../tests/staff-miniprogram-static.test.cjs) · [微信构建](../../../../../apps/staff-miniprogram/scripts/build.cjs)

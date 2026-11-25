# 员工经营目录

经营目录工厂提供品类、履约地点、型号目录与受保护图片路径。业务类型引用 Rental 合同，真实员工宿主传入原 `request`，原 API 路径导出同一实例的四个方法。[目录工厂](../directory.ts) · [Rental 合同](../../../src/contracts.ts) · [宿主薄入口](../../../../../apps/staff-miniprogram/src/api/context.ts)

## 接入与范围

```ts
import { createRentalStaffDirectoryApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";

const directory = createRentalStaffDirectoryApi({ request });
```

`listCategories()` 使用原 `tenant` 范围，返回当前会话采用的品类正文。`listLocations()` 与 `listItemGroups(force?)` 使用原运输默认的 `workspace` 范围。会话身份、员工 audience、权限、空间及地点投影由真实宿主和原服务端处理。[请求端口](../ports.ts) · [员工运输](../../../../../apps/staff-miniprogram/src/core/http.ts) · [员工门面映射](../../../../../apps/api/src/common/staff-api-routing.ts)

原型号目录注释写有“同一空间 60 秒内复用”。原实现每次调用都会发起请求，`force` 仅作为兼容形参，返回前把本次 rows 和时间写入局部变量。本工厂沿用该读取过程，局部变量归每个实例持有。[型号目录读取](../directory.ts)

`itemGroupImagePath()` 对型号与图片 ID 分别编码，返回 `/rental/v1/item-groups/.../images/...`。宿主 `core/images` 经 `apiUrl` 拼接员工门面前缀，再以原 `authHeaders()` 调用 `wx.downloadFile`。[图片加载](../../../../../apps/staff-miniprogram/src/core/images.ts)

## 调用链与直接消费者

员工上下文、扫码、商品和资产页面 → 原目录 API → 经营目录工厂 → 原员工运输 → 员工白名单门面 → Rental HTTP → 原领域服务与状态仓储。[目录与图片 HTTP](../../../src/http-core.controller.ts) · [领域服务](../../../src/mysql-core-runtime.ts) · [状态仓储](../../../src/mysql-state.ts)

宿主 `core/context` 负责当前术语、资产及检查字段、履约地点选择和会话版本核对。扫码、商品、资产登记和详情沿原目录入口读取型号与图片。[上下文消费者](../../../../../apps/staff-miniprogram/src/core/context.ts) · [扫码消费者](../../../../../apps/staff-miniprogram/src/core/scan.ts) · [商品消费者](../../../../../apps/staff-miniprogram/src/pages/product/index.ts) · [资产登记](../../../../../apps/staff-miniprogram/src/pages/asset-new/index.ts)

必要验证覆盖四个原方法签名与请求正文、原空间上下文消费者，以及编码后的员工图片地址与令牌下载。定向冒烟复用既有员工宿主替身和上下文用例。微信发布包、真机及真实业务服务分别沿原验证入口验收。[原员工测试](../../../../../tests/staff-miniprogram-static.test.cjs) · [微信构建](../../../../../apps/staff-miniprogram/scripts/build.cjs)

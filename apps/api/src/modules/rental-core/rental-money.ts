/**
 * 金额取整的**唯一**实现。
 *
 * 这个一行函数此前在六处各写一份（`rental-business.service.ts`、`rental-funding-events.ts`
 * 与四个纯计算模块），另有七处直接裸写 `Math.round(value * 100) / 100` 且漏掉
 * `Number.EPSILON`——恰好全在 `adjustmentAmount` / `finalPayableAmount` 上，
 * 最该稳的地方用了最不稳的写法。新代码一律从这里取。
 *
 * `+ Number.EPSILON` 不是装饰：`1.005` 的二进制表示略小于 1.005，
 * `Math.round(1.005 * 100)` 得 100 而不是 101。加一个最小步长把这类"差一点"推过边界。
 * 它只治舍入边界，**不治浮点本身**——金额链路仍是 `number`，换 Decimal 是另一件事。
 */
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

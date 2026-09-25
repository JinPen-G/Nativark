// 首页 2.0 预约搜索的统一状态：取货/归还门店、同店开关、取还时间（date+time）。
// 点「查看可租商品」时由此统一生成查询条件，避免状态散落在各组件。

import { useMemo, useState } from 'react';
import { nowInput, offsetDaysInput } from '../data/datetime';

export interface HeroSearch {
  pickupStoreId: string;
  returnStoreId: string;
  sameStore: boolean;
  startAt: string;
  endAt: string;
  /** datetime-local 的 min：不早于当前分钟。 */
  minStart: string;
  setPickup: (id: string) => void;
  setReturn: (id: string) => void;
  setSameStore: (value: boolean) => void;
  setStartAt: (value: string) => void;
  setEndAt: (value: string) => void;
  /** 归还门店的实际取值：同店时等于取货门店。 */
  effectiveReturnStoreId: string;
  /** 结束早于开始为无效。 */
  invalidRange: boolean;
  /** 生成商品列表查询串（不含前导 ?）；空字段自动省略。 */
  toQuery: () => string;
}

export function useHeroSearch(): HeroSearch {
  const minStart = useMemo(() => nowInput(), []);
  const [pickupStoreId, setPickup] = useState('');
  const [returnStoreId, setReturn] = useState('');
  const [sameStore, setSameStore] = useState(true);
  const [startAt, setStartAt] = useState(() => offsetDaysInput(1));
  const [endAt, setEndAt] = useState(() => offsetDaysInput(3));

  const effectiveReturnStoreId = sameStore ? pickupStoreId : returnStoreId;
  const invalidRange = Boolean(startAt && endAt && endAt <= startAt);

  function toQuery(): string {
    const params = new URLSearchParams();
    if (pickupStoreId) params.set('pickup', pickupStoreId);
    if (effectiveReturnStoreId) params.set('return', effectiveReturnStoreId);
    if (startAt) params.set('start', startAt);
    if (endAt) params.set('end', endAt);
    return params.toString();
  }

  return {
    pickupStoreId, returnStoreId, sameStore, startAt, endAt, minStart,
    setPickup, setReturn, setSameStore, setStartAt, setEndAt,
    effectiveReturnStoreId, invalidRange, toQuery,
  };
}

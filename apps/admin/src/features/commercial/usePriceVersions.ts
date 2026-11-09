import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { rentalCoreApi } from "@/api/rentalCore";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";

/**
 * PRICE-03：空间整体价格版本的读取入口，定价分组页与价格版本页共用。
 *
 * 两页各写一份「取前 100 版、找当前生效版、再取版本明细」会让查询键与
 * 「当前版本」的判据分叉：一处按 effectiveFrom 判、另一处按顺序判，
 * 同一时刻两页显示不同的「当前版本」。查询键固定在这里，
 * 保存定价分组后的 invalidate 也只需要对准这一组键。
 */
export const PRICE_VERSIONS_QUERY_KEY = ["rental-core", "price-versions"] as const;
export const priceVersionQueryKey = (sequence?: number) => ["rental-core", "price-version", sequence] as const;

export function usePriceVersions(options: { enabled?: boolean; detailEnabled?: boolean } = {}) {
  const scope = useListQueryIdentity();
  const enabled = options.enabled ?? true;
  const versions = useQuery({
    queryKey: [...PRICE_VERSIONS_QUERY_KEY, scope],
    queryFn: () => rentalCoreApi.priceVersions(1, 100),
    enabled
  });
  // 「当前生效」= 生效时间不晚于现在的第一版；列表按 sequence 倒序，因此 find 即最新一版。
  const currentVersion = versions.data?.rows.find((row) => !dayjs(row.effectiveFrom).isAfter(dayjs()));
  const currentVersionDetail = useQuery({
    queryKey: [...priceVersionQueryKey(currentVersion?.sequence), scope],
    queryFn: () => rentalCoreApi.priceVersion(currentVersion!.sequence),
    enabled: enabled && (options.detailEnabled ?? true) && Boolean(currentVersion)
  });
  return { versions, currentVersion, currentVersionDetail };
}

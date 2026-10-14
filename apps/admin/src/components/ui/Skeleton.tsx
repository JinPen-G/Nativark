import { Skeleton as ArcSkeleton, type SkeletonProps } from "@/registry/components/skeleton/skeleton";
import { useLocale } from "@/app/locale";
export function Skeleton(props: SkeletonProps) {
  const { t } = useLocale();
  return <ArcSkeleton {...props} label={props.label ?? t("加载中")} />;
}

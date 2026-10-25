import type { RentalItemGroupImage } from "@rental-os/shared";
import { useQuery } from "@tanstack/react-query";
import { Image } from "antd";
import { useEffect, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import styles from "./ItemGroupPhoto.module.css";

export function ItemGroupPhoto({ groupId, image, size = 56, presentation, alt }: { groupId: string; image: RentalItemGroupImage; size?: number; presentation?: "card"; alt?: string }) {
  const { t } = useLocale();
  const photo = useQuery({
    queryKey: ["rental-core", "item-group-image", groupId, image.id],
    queryFn: () => rentalCoreApi.itemGroupImageBlob(groupId, image.id),
    staleTime: 5 * 60_000
  });
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!photo.data) return;
    const next = URL.createObjectURL(photo.data);
    setFailed(false);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo.data]);

  if (presentation === "card") return <div className={styles.cover}>{url && !failed ? <img src={url} alt={alt ?? image.fileName} loading="lazy" onError={() => setFailed(true)} /> : <span className={styles.placeholder} role="status">{t(photo.isError || failed ? "图片暂不可用" : "图片载入中")}</span>}</div>;
  return <Image alt={image.fileName} width={size} height={size} src={url} fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='100%25' height='100%25' fill='%23f0f0f0'/%3E%3C/svg%3E" styles={{ root: { borderRadius: 8, overflow: "hidden" }, image: { objectFit: "cover" } }} />;
}

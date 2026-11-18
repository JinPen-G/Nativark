import type { RentalItemGroupImage } from "@rental-os/rental-core";
import { useQuery } from "@tanstack/react-query";
import { Image } from "antd";
import { useEffect, useState } from "react";
import { useRentalCatalogPageContext } from "./page-context";
import { useLocale } from "@rental-os/platform-admin/locale";
import styles from "./ItemGroupPhoto.module.css";

export function ItemGroupPhoto({
  groupId,
  image,
  size = 56,
  presentation,
  alt,
}: {
  groupId: string;
  image: RentalItemGroupImage;
  size?: number;
  presentation?: "card";
  alt?: string;
}) {
  const { t } = useLocale();
  const { api: rentalCoreApi, scopeKey } = useRentalCatalogPageContext();
  const photo = useQuery({
    queryKey: ["rental-core", "item-group-image", groupId, image.id, scopeKey],
    enabled: Boolean(scopeKey),
    queryFn: ({ signal }) => rentalCoreApi.itemGroupImageBlob(groupId, image.id, { signal }),
    staleTime: 5 * 60_000,
  });
  const photoIdentity = JSON.stringify([scopeKey, groupId, image.id]);
  const [loadedPhoto, setLoadedPhoto] = useState<{ identity: string; data: Blob; url: string }>();
  const [failed, setFailed] = useState(false);
  // 查询身份先于 effect 更新，渲染时复验原字节可挡住切换首帧的旧图。
  const url =
    loadedPhoto?.identity === photoIdentity && loadedPhoto.data === photo.data
      ? loadedPhoto.url
      : undefined;

  useEffect(() => {
    if (!photo.data) {
      setLoadedPhoto(undefined);
      setFailed(false);
      return;
    }
    const next = URL.createObjectURL(photo.data);
    setFailed(false);
    setLoadedPhoto({ identity: photoIdentity, data: photo.data, url: next });
    return () => URL.revokeObjectURL(next);
  }, [photo.data, photoIdentity]);

  if (presentation === "card")
    return (
      <div className={styles.cover}>
        {url && !failed ? (
          <img src={url} alt={alt ?? image.fileName} loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <span className={styles.placeholder} role="status">
            {t(photo.isError || failed ? "图片暂不可用" : "图片载入中")}
          </span>
        )}
      </div>
    );
  return (
    <Image
      alt={image.fileName}
      width={size}
      height={size}
      src={url}
      fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='100%25' height='100%25' fill='%23f0f0f0'/%3E%3C/svg%3E"
      styles={{ root: { borderRadius: 8, overflow: "hidden" }, image: { objectFit: "cover" } }}
    />
  );
}

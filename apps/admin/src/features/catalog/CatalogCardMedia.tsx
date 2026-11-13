/** Product listing Pro's media subtree/CSS, inside the existing Card quick look. Images retain the original authenticated reader. See archive/product-listing/SOURCE.md. */
import type { RentalItemGroup } from "@rental-os/shared";
import { ImageOff } from "lucide-react";
import { useLocale } from "@/app/locale";
import { ItemGroupPhoto } from "./ItemGroupPhoto";
import "./archive/product-listing/original.css";
import styles from "./CatalogCardMedia.module.css";

const source = {
  card: "product-listing_card__uqZRT",
  media: "product-listing_media__wSFOi",
  image: "product-listing_image__ZTB8J",
  hoverImage: "product-listing_hoverImage__xRj7G",
};

export function CatalogCardMedia({ group, label }: { group?: RentalItemGroup; label?: string }) {
  const { t } = useLocale();
  const images = group?.images ?? [];
  const cover = images.find(image => image.isCover) ?? images[0];
  const alternate = images.find(image => image.id !== cover?.id);
  return <div className={`${source.card} ${styles.root}`}>
    <div className={`${source.media} ${styles.frame}`}>
      {group && cover ? <div className={`${source.image} ${styles.photo}`}><ItemGroupPhoto groupId={group.id} image={cover} presentation="card" alt={group.name} /></div> : <div className={styles.empty} aria-label={label ?? group?.name}><ImageOff aria-hidden="true" /><span>{t(group ? "未上传照片" : "图片暂不可用")}</span></div>}
      {group && alternate && <div className={`${source.hoverImage} ${styles.photo}`} aria-hidden="true"><ItemGroupPhoto groupId={group.id} image={alternate} presentation="card" alt="" /></div>}
    </div>
  </div>;
}

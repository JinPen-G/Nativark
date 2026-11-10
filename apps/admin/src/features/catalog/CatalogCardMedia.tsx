/** Product listing Pro's media subtree/CSS, inside the existing Card quick look. Images retain the original authenticated reader. See archive/product-listing/SOURCE.md. */
import type { RentalItemGroup } from "@rental-os/shared";
import { ItemGroupPhoto } from "./ItemGroupPhoto";
import "./archive/product-listing/original.css";
import styles from "./CatalogCardMedia.module.css";

const source = {
  card: "product-listing_card__uqZRT",
  media: "product-listing_media__wSFOi",
  image: "product-listing_image__ZTB8J",
  hoverImage: "product-listing_hoverImage__xRj7G",
};

export function CatalogCardMedia({ group }: { group: RentalItemGroup }) {
  const images = group.images ?? [];
  const cover = images.find(image => image.isCover) ?? images[0];
  const alternate = images.find(image => image.id !== cover?.id);
  if (!cover) return null;
  return <div className={`${source.card} ${styles.root}`}>
    <div className={`${source.media} ${styles.frame}`}>
      <div className={`${source.image} ${styles.photo}`}><ItemGroupPhoto groupId={group.id} image={cover} presentation="card" alt={group.name} /></div>
      {alternate && <div className={`${source.hoverImage} ${styles.photo}`} aria-hidden="true"><ItemGroupPhoto groupId={group.id} image={alternate} presentation="card" alt="" /></div>}
    </div>
  </div>;
}

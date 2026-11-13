import { Link } from "react-router-dom";
import { useSite } from "../SiteContext";
import { Img } from "./Img";
import type { Product } from "../types";
import { knownMoney } from "../data/money";

export function ProductCard({
  product,
  search = "",
}: {
  product: Product;
  search?: string;
}) {
  const { href, language, isRemote } = useSite();
  const en = language === "en";
  const unavailable =
    product.stockStatus === "unavailable" || product.availableQuantity === 0;
  const price = knownMoney(product.price, product.currency);
  const productTo = href(
    `/product/${encodeURIComponent(product.id)}${search ? "?" + search : ""}`,
  );
  return (
    <article className="product-card">
      <Link
        className="product-image-link"
        to={productTo}
        aria-label={en ? `View ${product.name}` : `查看${product.name}`}
      >
        <Img src={product.cover} alt={product.name} width="640" height="640" />
        {unavailable && (
          <span className="product-unavailable">
            {en ? "Currently unavailable" : "暂时不可租"}
          </span>
        )}
      </Link>
      <div className="product-card-content">
        <h3>
          <Link to={productTo}>{product.name}</Link>
        </h3>
        <p>{product.subtitle}</p>
        <div className="product-card-price">
          <strong>{price ?? (en ? "Request a quote" : "查看报价")}</strong>
          {price && (
            <span>
              / {product.priceUnit === "天" && en ? "day" : product.priceUnit}
            </span>
          )}
          <small>
            {isRemote
              ? en
                ? "Reference price"
                : "参考价格"
              : en
                ? "Demo rate"
                : "演示日租"}
          </small>
        </div>
      </div>
    </article>
  );
}

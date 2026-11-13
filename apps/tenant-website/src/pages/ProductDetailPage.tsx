import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  Calendar,
  Guide,
  Headphones,
  Minus,
  Plus,
  Store,
} from "../components/SiteIcon";
import { useSite } from "../SiteContext";
import { ProductCard } from "../components/ProductCard";
import { Breadcrumbs } from "../components/PageHeader";
import { PageState } from "../components/PageState";
import { Img } from "../components/Img";
import { rentalDays, siteRepository } from "../data/siteRepository";
import { nowInput, offsetDaysInput, validRentalPeriod } from "../data/datetime";
import { knownMoney } from "../data/money";
import { rentalQuery } from "../data/rentalQuery";
import { useActiveRail } from "../hooks/useActiveRail";

export function ProductDetailPage() {
  const {
    tenant,
    href,
    isRemote,
    productsReady,
    localizeProduct,
    language,
    t,
  } = useSite();
  const { productId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rawProduct = siteRepository.getProduct(tenant, productId || "");
  const product = rawProduct ? localizeProduct(rawProduct) : null;
  const queryQuantity = Number(params.get("qty") || 1);
  const requestedQuantity = Number.isFinite(queryQuantity) ? queryQuantity : 1;
  const [startDate, setStartDate] = useState(
    params.get("start") || offsetDaysInput(1),
  );
  const [endDate, setEndDate] = useState(
    params.get("end") || offsetDaysInput(3),
  );
  const [quantity, setQuantity] = useState(requestedQuantity);
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">(
    params.get("fulfillment") === "delivery" ? "delivery" : "pickup",
  );
  const [tab, setTab] = useState("intro");
  const tabRail = useActiveRail<HTMLDivElement>(`${tab}:${language}`);
  const en = language === "en";

  useEffect(() => {
    setStartDate(params.get("start") || offsetDaysInput(1));
    setEndDate(params.get("end") || offsetDaysInput(3));
    setQuantity(requestedQuantity);
    setFulfillment(
      params.get("fulfillment") === "delivery" ? "delivery" : "pickup",
    );
    setTab("intro");
  }, [productId, params, requestedQuantity]);

  if (!product && isRemote && !productsReady)
    return (
      <div
        className="shell detail-page"
        role="status"
        aria-label={t("loading")}
      >
        <div className="detail-grid" aria-hidden="true">
          <div className="detail-main-image sk-block" />
          <div>
            <div className="sk-line sk-line-lg" />
            <div className="sk-line" />
          </div>
        </div>
      </div>
    );
  if (!product)
    return (
      <div className="shell missing-page">
        <PageState
          heading="h1"
          title={t("missingProduct")}
          description={
            en
              ? "Browse the catalog for another rental."
              : "可以返回目录，看看其他商品。"
          }
        >
          <Link className="button button-dark" to={href("/products")}>
            {t("returnProducts")}
          </Link>
        </PageState>
      </div>
    );

  const category = tenant.categories.find(
    (item) => item.id === product.categoryId,
  );
  const pickupStore = tenant.stores?.find(
    (store) => store.id === params.get("pickup"),
  );
  const returnStore = tenant.stores?.find(
    (store) => store.id === params.get("return"),
  );
  const days = rentalDays(startDate, endDate);
  const available =
    product.stockStatus !== "unavailable" && product.availableQuantity !== 0;
  const validTerm = validRentalPeriod(startDate, endDate);
  const validQuantity =
    Number.isSafeInteger(quantity) &&
    quantity > 0 &&
    (product.availableQuantity === undefined ||
      quantity <= product.availableQuantity);
  const price = knownMoney(product.price, product.currency);
  const deposit = knownMoney(product.deposit, product.currency);
  const estimate =
    !isRemote && validTerm && validQuantity && product.price !== undefined
      ? knownMoney(product.price * days * quantity, product.currency)
      : null;
  const contextQuery = rentalQuery(params, {
    start: startDate,
    end: endDate,
    quantity,
    fulfillment,
  });
  const related = siteRepository
    .getProducts(tenant)
    .filter(
      (item) =>
        item.categoryId === product.categoryId && item.id !== product.id,
    )
    .slice(0, 4)
    .map(localizeProduct);
  const tabs = [
    { id: "intro", label: t("intro") },
    { id: "specs", label: t("specs") },
    { id: "rules", label: t("rentalRules") },
    { id: "deposit", label: t("depositRules") },
    { id: "fulfillment", label: t("fulfillment") },
    { id: "reviews", label: t("reviews") },
  ];

  function book(event: FormEvent) {
    event.preventDefault();
    if (!product || !available || !validTerm || !validQuantity) return;
    navigate(
      href(`/booking/${encodeURIComponent(product.id)}?${contextQuery}`),
    );
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setTab(tabs[next].id);
    document
      .getElementById("detail-tab-" + tabs[next].id)
      ?.focus({ preventScroll: true });
  }

  return (
    <div className="shell detail-page">
      <Breadcrumbs
        items={[
          { label: t("home"), to: href("/") },
          {
            label: category?.name || t("allProducts"),
            to: href(
              `/category/${encodeURIComponent(product.categoryId)}?${contextQuery}`,
            ),
          },
          { label: product.name },
        ]}
      />
      <div className="detail-grid">
        <div className="detail-gallery">
          <div className="detail-main-image">
            <Img
              src={product.cover}
              alt={product.name}
              loading="eager"
              width="800"
              height="800"
            />
          </div>
          <p className="detail-image-note">
            {isRemote
              ? en
                ? "Review the configuration and included accessories before booking."
                : "预约前请核对具体配置与所含配件。"
              : en
                ? "Demo product image. Confirm the live model and configuration when booking."
                : "演示商品图片，正式预约时核对实物型号与配置。"}
          </p>
        </div>
        <div className="detail-summary">
          <h1>{product.name}</h1>
          <p className="detail-subtitle">{product.subtitle}</p>
          <div className="detail-tags">
            {product.tags.map((tag) => (
              <span className="quiet-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <p className="stock-note">
            {!available
              ? t("unavailable")
              : product.stockStatus === "unknown"
                ? en
                  ? "Availability is confirmed for your selected dates."
                  : "所选租期的库存待确认。"
                : en
                  ? `${product.availableQuantity ?? ""} available in the demo catalog`
                  : `演示目录可用 ${product.availableQuantity ?? "—"} 件`}
          </p>
          <div className="detail-price">
            <strong>{price ?? (en ? "Request a quote" : "查看报价")}</strong>
            {price && (
              <span>
                / {product.priceUnit === "天" && en ? "day" : product.priceUnit}
              </span>
            )}
            <small>
              {deposit
                ? `${en ? "Reference deposit" : "参考押金"} ${deposit}`
                : en
                  ? "Deposit confirmed in quote"
                  : "押金以报价为准"}
            </small>
          </div>
          <form className="rental-panel" onSubmit={book}>
            <h2>
              <Calendar aria-hidden="true" />
              {t("chooseRentalPlan")}
            </h2>
            {pickupStore && (
              <p className="selected-pickup">
                {en ? "Pickup store" : "取货门店"} {pickupStore.name}
                {returnStore &&
                  returnStore.id !== pickupStore.id &&
                  ` / ${en ? "Return" : "归还"} ${returnStore.name}`}
              </p>
            )}
            <div className="form-grid">
              <label>
                {t("startDate")}
                <input
                  type="datetime-local"
                  min={nowInput()}
                  required
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <label>
                {t("endDate")}
                <input
                  type="datetime-local"
                  min={startDate || nowInput()}
                  required
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                {t("rentalQuantity")}
                <span className="quantity-field">
                  <button
                    type="button"
                    disabled={!available || quantity <= 1}
                    aria-label={en ? "Decrease quantity" : "减少数量"}
                    onClick={() => setQuantity(quantity - 1)}
                  >
                    <Minus />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={product.availableQuantity}
                    step={1}
                    required
                    inputMode="numeric"
                    value={quantity || ""}
                    disabled={!available}
                    aria-label={t("rentalQuantity")}
                    onChange={(event) =>
                      setQuantity(Number(event.target.value))
                    }
                  />
                  <button
                    type="button"
                    disabled={
                      !available ||
                      (product.availableQuantity !== undefined &&
                        quantity >= product.availableQuantity)
                    }
                    aria-label={en ? "Increase quantity" : "增加数量"}
                    onClick={() => setQuantity(quantity + 1)}
                  >
                    <Plus />
                  </button>
                </span>
              </label>
              <label>
                {t("pickupDelivery")}
                <select
                  value={fulfillment}
                  onChange={(event) =>
                    setFulfillment(event.target.value as "pickup" | "delivery")
                  }
                >
                  <option value="pickup">{t("pickup")}</option>
                  <option value="delivery">{en ? "Delivery" : "配送"}</option>
                </select>
              </label>
            </div>
            {!validTerm && (
              <p className="form-error" role="alert">
                {en
                  ? "Choose a future pickup and a later return time."
                  : "请选择未来的取货时间，归还时间需晚于取货时间。"}
              </p>
            )}
            {!validQuantity && available && (
              <p className="form-error" role="alert">
                {en
                  ? "Choose a whole quantity within the available stock."
                  : "请输入正整数数量，并核对可用库存。"}
              </p>
            )}
            <div className="rental-estimate">
              <span>
                {en ? "Selected term" : "所选租期"}
                <strong>
                  {validTerm
                    ? `${days} ${en ? "calendar day(s)" : "个自然日"}`
                    : "—"}
                </strong>
              </span>
              <span>
                {en ? "Reference rent" : "参考租金"}
                <strong>
                  {estimate ?? (en ? "Confirmed in quote" : "以报价为准")}
                </strong>
              </span>
            </div>
            <button
              className="button button-dark button-block"
              type="submit"
              disabled={!available || !validTerm || !validQuantity}
            >
              {en ? "Continue to booking" : "继续预约"}
              <ArrowRight aria-hidden="true" />
            </button>
            <p className="mock-note">
              {isRemote
                ? en
                  ? "The quote confirms your billable term, rent, deposit and availability."
                  : "计费租期、租金、押金及可用性由预约报价确认。"
                : t("demoBookingNote")}
            </p>
          </form>
          <div className="detail-service">
            <Link to={href("/guide")}>
              <Guide />
              {en ? "Rental guide" : "租赁流程"}
            </Link>
            <Link to={href("/about#stores")}>
              <Store />
              {en ? "Our stores" : "门店信息"}
            </Link>
            <Link to={href("/help")}>
              <Headphones />
              {en ? "Rental help" : "租赁帮助"}
            </Link>
          </div>
        </div>
      </div>

      <section className="detail-info">
        <div
          ref={tabRail}
          className="detail-tabs"
          role="tablist"
          aria-label={t("detailTabs")}
        >
          {tabs.map((item, index) => (
            <button
              key={item.id}
              type="button"
              id={"detail-tab-" + item.id}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls="detail-tab-panel"
              tabIndex={tab === item.id ? 0 : -1}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          className="detail-tab-content"
          id="detail-tab-panel"
          role="tabpanel"
          aria-labelledby={"detail-tab-" + tab}
          tabIndex={0}
        >
          {tab === "intro" && (
            <>
              <h2>{t("aboutProduct")}</h2>
              <p>{product.description}</p>
            </>
          )}
          {tab === "specs" && (
            <>
              <h2>{t("specs")}</h2>
              {Object.keys(product.specs).length ? (
                <dl className="spec-list">
                  {Object.entries(product.specs).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>
                  {en
                    ? "Ask the store to confirm the configuration."
                    : "具体配置请在预约前向门店确认。"}
                </p>
              )}
            </>
          )}
          {tab === "rules" && (
            <>
              <h2>{t("rentalRules")}</h2>
              <ul>
                <li>
                  {isRemote
                    ? en
                      ? "Your quote confirms the billable term and rental rules."
                      : "计费租期与租赁规则由正式报价确认。"
                    : t("ruleOne")}
                </li>
                <li>{t("ruleTwo")}</li>
                <li>{t("ruleThree")}</li>
              </ul>
            </>
          )}
          {tab === "deposit" && (
            <>
              <h2>{t("depositRules")}</h2>
              <p>
                {deposit
                  ? `${en ? "Reference deposit per item" : "每件参考押金"} ${deposit}${en ? ". " : "。"}`
                  : en
                    ? "Your quote confirms the deposit amount. "
                    : "押金金额由正式报价确认。"}
                {en
                  ? "The store confirms collection, waiver and return conditions before booking."
                  : "收取方式、免押条件与退还时间需在正式预约前确认。"}
              </p>
            </>
          )}
          {tab === "fulfillment" && (
            <>
              <h2>{t("fulfillment")}</h2>
              <p>{t("fulfillmentText")}</p>
              <Link className="text-link" to={href("/about#stores")}>
                {en ? "Find a store" : "查看门店"}
              </Link>
            </>
          )}
          {tab === "reviews" && (
            <>
              <h2>{t("reviews")}</h2>
              <p>
                {en
                  ? "No public reviews have been published yet."
                  : "暂未发布公开评价。"}
              </p>
            </>
          )}
        </div>
      </section>
      {related.length > 0 && (
        <section className="related-products">
          <div className="section-heading">
            <h2>{t("related")}</h2>
          </div>
          <div className="product-grid">
            {related.map((item) => (
              <ProductCard
                product={item}
                search={contextQuery.toString()}
                key={item.id}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

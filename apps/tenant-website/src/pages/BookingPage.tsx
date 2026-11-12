import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Calendar, Receipt, Store, Truck } from "../components/SiteIcon";
import { Breadcrumbs, PageHeading } from "../components/PageHeader";
import { LoadingState, PageState } from "../components/PageState";
import { useSite } from "../SiteContext";
import { useAuth } from "../AuthContext";
import { RemoteBooking } from "../components/RemoteBooking";
import { useToast } from "../components/Toast";
import { Img } from "../components/Img";
import { rentalDays, siteRepository } from "../data/siteRepository";
import { nowInput, offsetDaysInput, validRentalPeriod } from "../data/datetime";
import { knownMoney } from "../data/money";
import { rentalQuery } from "../data/rentalQuery";
import type { DemoOrder } from "../types";
import { useBookingHandoffHost } from "../features/ai-native/BookingHandoffHost";
import { BookingHandoffPanel } from "../features/ai-native/BookingHandoffPanel";
import { handoffLocalInput } from "../features/ai-native/booking-handoff";

/** 预约选择交给原服务端报价与建单入口，本地演示单独标记并保存。 */
export function BookingPage() {
  const {
    tenant,
    tenantCode,
    href,
    isRemote,
    productsReady,
    localizeProduct,
    language,
    t,
  } = useSite();
  const { isAuthenticated, session, currentWorkspace } = useAuth();
  const handoffHost = useBookingHandoffHost();
  const toast = useToast();
  const { productId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rawProduct = siteRepository.getProduct(tenant, productId || "");
  const product = rawProduct ? localizeProduct(rawProduct) : null;
  const parsedQuantity = Number(params.get("qty") || 1);
  const requestedQuantity = Number.isFinite(parsedQuantity)
    ? parsedQuantity
    : 1;
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
  const [pickupStoreId, setPickupStoreId] = useState(
    params.get("pickup") || "",
  );
  const [returnStoreId, setReturnStoreId] = useState(
    params.get("return") || "",
  );
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submissionId = useRef<string | null>(null);
  const submittedAt = useRef<string | null>(null);
  const submitting = useRef(false);
  const identity = JSON.stringify([tenant.id, productId]);
  const owner = useRef(identity);
  owner.current = identity;
  const en = language === "en";
  const remoteNeedsLogin = isRemote && !isAuthenticated;

  useEffect(() => {
    setStartDate(params.get("start") || offsetDaysInput(1));
    setEndDate(params.get("end") || offsetDaysInput(3));
    setQuantity(requestedQuantity);
    setFulfillment(
      params.get("fulfillment") === "delivery" ? "delivery" : "pickup",
    );
    setPickupStoreId(params.get("pickup") || "");
    setReturnStoreId(params.get("return") || "");
    setError("");
  }, [productId, params, requestedQuantity]);
  useEffect(() => {
    setContactName("");
    setContactPhone("");
    setNote("");
    setDeliveryAddress("");
    submissionId.current = null;
    submittedAt.current = null;
    submitting.current = false;
    setSaving(false);
  }, [identity]);
  useEffect(() => {
    if (remoteNeedsLogin && productId)
      navigate(
        href(
          `/login?redirect=${encodeURIComponent(`/booking/${productId}?${params}`)}`,
        ),
        { replace: true },
      );
  }, [remoteNeedsLogin, productId, params]);

  if (!product && isRemote && !productsReady)
    return (
      <div className="shell booking-page">
        <LoadingState label={t("loading")} />
      </div>
    );
  if (!product)
    return (
      <div className="shell missing-page">
        <PageState heading="h1" title={t("missingProduct")}>
          <Link className="button button-dark" to={href("/products")}>
            {t("returnProducts")}
          </Link>
        </PageState>
      </div>
    );
  if (remoteNeedsLogin)
    return (
      <div className="shell booking-page">
        <LoadingState label={t("loginRequired")} />
      </div>
    );

  const remoteMode = isRemote && isAuthenticated;
  const days = rentalDays(startDate, endDate);
  const validTerm = validRentalPeriod(startDate, endDate);
  const validQuantity =
    Number.isSafeInteger(quantity) &&
    quantity > 0 &&
    (product.availableQuantity === undefined ||
      quantity <= product.availableQuantity);
  const available =
    product.stockStatus !== "unavailable" && product.availableQuantity !== 0;
  const rentalAmount =
    !remoteMode && validTerm && validQuantity && product.price !== undefined
      ? product.price * quantity * days
      : undefined;
  const depositAmount =
    !remoteMode && validQuantity && product.deposit !== undefined
      ? product.deposit * quantity
      : undefined;
  const pickupStores = (tenant.stores ?? []).filter(
    (store) => !store.capabilities || store.capabilities.includes("pickup"),
  );
  const returnStores = (tenant.stores ?? []).filter(
    (store) => !store.capabilities || store.capabilities.includes("return"),
  );
  const navigationParams = new URLSearchParams(params);
  if (pickupStoreId) navigationParams.set("pickup", pickupStoreId);
  else navigationParams.delete("pickup");
  if (returnStoreId) navigationParams.set("return", returnStoreId);
  else navigationParams.delete("return");
  const productTo = href(
    `/product/${encodeURIComponent(product.id)}?${rentalQuery(navigationParams, { start: startDate, end: endDate, quantity, fulfillment })}`,
  );
  const price = knownMoney(product.price, product.currency);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!product || !rawProduct || submitting.current) return;
    setError("");
    if (!validTerm) {
      setError(
        en
          ? "Choose a future pickup and a later return time."
          : "请选择未来的取货时间，归还时间需晚于取货时间。",
      );
      return;
    }
    if (
      !available ||
      !validQuantity ||
      rentalAmount === undefined ||
      depositAmount === undefined ||
      !knownMoney(rentalAmount, product.currency) ||
      !knownMoney(depositAmount, product.currency)
    ) {
      setError(t("invalidQuantity"));
      return;
    }
    if (
      pickupStores.length &&
      !pickupStores.some((store) => store.id === pickupStoreId)
    ) {
      setError(en ? "Choose a pickup store." : "请选择取货门店。");
      return;
    }
    if (
      returnStores.length &&
      !returnStores.some((store) => store.id === returnStoreId)
    ) {
      setError(en ? "Choose a return store." : "请选择归还门店。");
      return;
    }
    if (fulfillment === "delivery" && !deliveryAddress.trim()) {
      setError(en ? "Enter a demo delivery address." : "请填写演示配送地址。");
      return;
    }
    if (!contactName.trim()) {
      setError(t("requiredName"));
      return;
    }
    if (!/^1\d{10}$/.test(contactPhone.trim())) {
      setError(t("requiredPhone"));
      return;
    }
    const operationOwner = identity;
    submitting.current = true;
    setSaving(true);
    try {
      submissionId.current ??= `DEMO-${crypto.randomUUID()}`;
      submittedAt.current ??= new Date().toISOString();
      const order: DemoOrder = {
        id: submissionId.current,
        tenantId: tenant.id,
        productId: product.id,
        startDate,
        endDate,
        quantity,
        fulfillment,
        currency: product.currency,
        pickupStoreId,
        returnStoreId,
        ...(fulfillment === "delivery"
          ? { deliveryAddress: deliveryAddress.trim() }
          : {}),
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        note: note.trim(),
        rentalAmount,
        depositAmount,
        createdAt: submittedAt.current,
        productSnapshot: {
          name: rawProduct.name,
          nameEn: rawProduct.nameEn,
          subtitle: rawProduct.subtitle,
          subtitleEn: rawProduct.subtitleEn,
          cover: rawProduct.cover,
        },
      };
      await siteRepository.saveOrder(order);
      if (owner.current !== operationOwner) return;
      toast.success(t("bookingSaved"));
      navigate(href(`/orders/${encodeURIComponent(order.id)}`));
    } catch {
      if (owner.current === operationOwner)
        setError(
          en
            ? "The browser could not confirm saving. Check your rentals, then retry with the same details."
            : "浏览器尚未确认保存。请先查看我的租赁，再按原信息重试。",
        );
    } finally {
      if (owner.current === operationOwner) {
        submitting.current = false;
        setSaving(false);
      }
    }
  }

  const productSection = (
    <section className="booking-card" id="booking-product">
      <h2>{t("chooseProduct")}</h2>
      <div className="booking-product">
        <Img src={product.cover} alt="" width="800" height="800" />
        <div>
          <strong>{product.name}</strong>
          <p>{product.subtitle}</p>
          <span>
            {price
              ? `${price} / ${product.priceUnit === "天" && en ? "day" : product.priceUnit}`
              : en
                ? "Price confirmed in quote"
                : "费用由报价确认"}
          </span>
        </div>
      </div>
      <Link className="text-link" to={productTo}>
        {en ? "Review product details" : "返回查看商品详情"}
      </Link>
    </section>
  );

  const termSection = (
    <section className="booking-card" id="booking-term">
      <h2>
        <Calendar aria-hidden="true" />
        {t("chooseTerm")}
      </h2>
      <div className="form-grid">
        <label>
          {t("startDate")}
          <input
            type="datetime-local"
            required
            min={nowInput()}
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              setError("");
            }}
          />
        </label>
        <label>
          {t("endDate")}
          <input
            type="datetime-local"
            required
            min={startDate || nowInput()}
            value={endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
              setError("");
            }}
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          {t("rentalQuantity")}
          <input
            type="number"
            min={1}
            max={product.availableQuantity}
            step={1}
            required
            inputMode="numeric"
            value={quantity || ""}
            onChange={(event) => {
              setQuantity(Number(event.target.value));
              setError("");
            }}
          />
        </label>
        <p className="field-note">
          {en ? "Selected term" : "所选租期"}{" "}
          {validTerm ? `${days} ${en ? "calendar day(s)" : "个自然日"}` : "—"}
          <br />
          {en
            ? "Billable terms are confirmed in the quote."
            : "计费租期以正式报价为准。"}
        </p>
      </div>
      {!validTerm && (
        <p className="form-error" role="alert">
          {en
            ? "Pickup must be in the future and return must be later."
            : "取货时间需在未来，归还时间需晚于取货时间。"}
        </p>
      )}
      {!validQuantity && (
        <p className="form-error" role="alert">
          {en
            ? "Choose a whole quantity within the available stock."
            : "请输入正整数数量，并核对可用库存。"}
        </p>
      )}
      {!available && (
        <p className="form-error" role="alert">
          {t("unavailable")}
        </p>
      )}
    </section>
  );

  const fulfillmentSection = (
    <section className="booking-card" id="booking-fulfillment">
      <h2>{t("pickupDelivery")}</h2>
      <div
        className="choice-group"
        role="radiogroup"
        aria-label={t("pickupDelivery")}
      >
        <label className={fulfillment === "pickup" ? "choice-active" : ""}>
          <input
            type="radio"
            name="fulfillment"
            checked={fulfillment === "pickup"}
            onChange={() => {
              setFulfillment("pickup");
              setError("");
            }}
          />
          <span>
            <strong>
              <Store aria-hidden="true" />
              {t("pickup")}
            </strong>
            <small>{t("pickupDescription")}</small>
          </span>
        </label>
        <label className={fulfillment === "delivery" ? "choice-active" : ""}>
          <input
            type="radio"
            name="fulfillment"
            checked={fulfillment === "delivery"}
            onChange={() => {
              setFulfillment("delivery");
              setError("");
            }}
          />
          <span>
            <strong>
              <Truck aria-hidden="true" />
              {en ? "Delivery" : "配送"}
            </strong>
            <small>{t("deliveryFeeDescription")}</small>
          </span>
        </label>
      </div>
      {!remoteMode && (
        <div className="form-grid booking-location-fields">
          <label>
            {en ? "Pickup / service store" : "取货与服务门店"}
            <select
              value={pickupStoreId}
              required={pickupStores.length > 0}
              onChange={(event) => {
                const id = event.target.value;
                setPickupStoreId(id);
                if (!returnStoreId || returnStoreId === pickupStoreId)
                  setReturnStoreId(
                    returnStores.some((store) => store.id === id) ? id : "",
                  );
                setError("");
              }}
            >
              <option value="">{en ? "Choose a store" : "选择门店"}</option>
              {pickupStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {en ? "Return store" : "归还门店"}
            <select
              value={returnStoreId}
              required={returnStores.length > 0}
              onChange={(event) => {
                setReturnStoreId(event.target.value);
                setError("");
              }}
            >
              <option value="">{en ? "Choose a store" : "选择门店"}</option>
              {returnStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {!remoteMode && fulfillment === "delivery" && (
        <label className="full-field">
          {en ? "Demo delivery address" : "演示配送地址"}
          <textarea
            required
            rows={2}
            maxLength={255}
            value={deliveryAddress}
            autoComplete="shipping street-address"
            onChange={(event) => {
              setDeliveryAddress(event.target.value);
              setError("");
            }}
            placeholder={
              en
                ? "Use a sample address to try the form"
                : "填写示例地址体验配送表单"
            }
          />
        </label>
      )}
    </section>
  );

  const demoQuote = (
    <aside className="booking-aside" id="booking-quote">
      <div className="booking-card booking-total">
        <h2>
          <Receipt aria-hidden="true" />
          {t("costConfirm")}
        </h2>
        <dl>
          <div>
            <dt>{t("estimatedRent")}</dt>
            <dd>{knownMoney(rentalAmount, product.currency) ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("referenceDeposit")}</dt>
            <dd>{knownMoney(depositAmount, product.currency) ?? "—"}</dd>
          </div>
          <div className="booking-grand-total">
            <dt>{t("totalEstimated")}</dt>
            <dd>
              {rentalAmount !== undefined && depositAmount !== undefined
                ? knownMoney(rentalAmount + depositAmount, product.currency)
                : "—"}
            </dd>
          </div>
        </dl>
        <p>{t("feeNote")}</p>
        {error && (
          <div className="form-error" role="alert">
            <p>{error}</p>
            <Link className="text-link" to={href("/orders")}>
              {en ? "Check my rentals" : "查看我的租赁"}
            </Link>
          </div>
        )}
        <button
          type="submit"
          className="button button-dark button-block"
          disabled={saving || !validTerm || !validQuantity || !available}
        >
          {saving ? (en ? "Saving…" : "正在保存…") : t("submitDemo")}
        </button>
        <p className="mock-note">{t("submitNote")}</p>
      </div>
    </aside>
  );

  return (
    <div className="shell booking-page">
      <Breadcrumbs
        items={[
          { label: t("home"), to: href("/") },
          { label: product.name, to: productTo },
          { label: t("bookingTitle") },
        ]}
      />
      <div className="booking-heading">
        <PageHeading
          title={t("bookingTitle")}
          description={
            en
              ? "Review the equipment, dates and collection arrangements."
              : "核对商品、租期与取还安排。"
          }
        />
        <ol
          className="booking-progress"
          aria-label={en ? "Booking process" : "预约流程"}
        >
          <li>
            <span>1</span>
            {en ? "Equipment" : "选商品"}
          </li>
          <li className="active" aria-current="step">
            <span>2</span>
            {en ? "Details" : "填信息"}
          </li>
          <li>
            <span>3</span>
            {en ? "Review" : "核对预约"}
          </li>
        </ol>
      </div>
      {remoteMode || handoffHost?.enabled === true ? (
        handoffHost?.enabled === true ? (
          <BookingHandoffPanel
            host={handoffHost}
            sessionIdentity={session}
            english={en}
            context={{
              tenantCode,
              workspaceCode: currentWorkspace?.workspaceCode,
              customerId: session?.customer.customerId,
              authenticated: isRemote && isAuthenticated,
              productId: product.id,
            }}
            onContinue={(handoff) => {
              setStartDate(
                handoffLocalInput(
                  handoff.fields.startAt,
                  handoff.fields.timeZone,
                ),
              );
              setEndDate(
                handoffLocalInput(
                  handoff.fields.endAt,
                  handoff.fields.timeZone,
                ),
              );
              setQuantity(handoff.fields.lines[0].quantity);
              setFulfillment(
                handoff.fields.fulfillmentMode === "delivery"
                  ? "delivery"
                  : "pickup",
              );
            }}
          >
            {(handoff) => (
              <div className="booking-layout">
                <fieldset className="booking-form" disabled>
                  {productSection}
                  {termSection}
                  {fulfillmentSection}
                  <p className="field-note">
                    {en
                      ? "To change the original material, prepare a new selection."
                      : "修改原材料需要重新准备选择。"}
                  </p>
                  <p
                    className="field-note"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {handoff.fields.fulfillmentLocationId}
                    {handoff.fields.deliveryAddressId
                      ? ` / ${handoff.fields.deliveryAddressId}`
                      : ""}
                  </p>
                </fieldset>
                <aside className="booking-aside" id="booking-quote">
                  <RemoteBooking
                    product={product}
                    startDate={startDate}
                    endDate={endDate}
                    quantity={quantity}
                    fulfillment={fulfillment}
                    handoff={handoff}
                  />
                </aside>
              </div>
            )}
          </BookingHandoffPanel>
        ) : (
          <div className="booking-layout">
            <div className="booking-form">
              {productSection}
              {termSection}
              {fulfillmentSection}
            </div>
            <aside className="booking-aside" id="booking-quote">
              <RemoteBooking
                product={product}
                startDate={startDate}
                endDate={endDate}
                quantity={quantity}
                fulfillment={fulfillment}
                preferredLocationId={pickupStoreId}
                preferredReturnLocationId={returnStoreId}
                onLocationChange={setPickupStoreId}
                onReturnLocationChange={setReturnStoreId}
              />
            </aside>
          </div>
        )
      ) : (
        <form className="booking-layout" onSubmit={submit} aria-busy={saving}>
          <div className="booking-form">
            {productSection}
            {termSection}
            {fulfillmentSection}
            <section
              className="booking-card booking-contact"
              id="booking-contact"
            >
              <h2>{t("contact")}</h2>
              <div className="form-grid">
                <label>
                  {t("contactName")}
                  <input
                    required
                    autoComplete="name"
                    maxLength={120}
                    value={contactName}
                    onChange={(event) => {
                      setContactName(event.target.value);
                      setError("");
                    }}
                    placeholder={t("namePlaceholder")}
                  />
                </label>
                <label>
                  {t("contactPhone")}
                  <input
                    required
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    maxLength={11}
                    value={contactPhone}
                    onChange={(event) => {
                      setContactPhone(event.target.value);
                      setError("");
                    }}
                    placeholder={t("phonePlaceholder")}
                  />
                </label>
              </div>
              <label className="full-field">
                {t("noteOptional")}
                <textarea
                  value={note}
                  maxLength={1000}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("notePlaceholder")}
                  rows={3}
                />
              </label>
            </section>
          </div>
          {demoQuote}
        </form>
      )}
    </div>
  );
}

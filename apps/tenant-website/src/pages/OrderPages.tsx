import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  safeDocumentHref,
  type ClientOrderView,
  type ClientPaymentIntentResponse,
} from "@rental-os/shared";
import { Calendar, Receipt, Store, Payment } from "../components/SiteIcon";
import { MemberLayout } from "../components/MemberLayout";
import { Breadcrumbs, PageHeading } from "../components/PageHeader";
import { LoadingState, PageState } from "../components/PageState";
import { useSite } from "../SiteContext";
import { useAuth } from "../AuthContext";
import { sessionApi } from "../data/authClient";
import { siteRepository } from "../data/siteRepository";
import { knownMoney } from "../data/money";
import { Img } from "../components/Img";
import { customerOrderFacts } from "../features/ai-native/customer-order-facts";
import { ClientTaskWorkbench } from "../features/ai-native/ClientTaskWorkbench";
import { EnterpriseExtensionApproval } from "../components/EnterpriseExtensionApproval";
import { EnterpriseExchangeProgress } from "../components/EnterpriseExchangeProgress";
import { EnterpriseExchangeRequest } from "../components/EnterpriseExchangeRequest";

const date = (value: unknown) => {
  if (typeof value !== "string") return "—";
  const zone = value.endsWith("Z")
    ? " UTC"
    : (value.match(/[+-]\d{2}:\d{2}$/)?.[0] ?? "");
  return value.slice(0, 16).replace("T", " ") + zone;
};

const statusKeys = {
  draft: "orderStatus_draft",
  reserved: "orderStatus_reserved",
  pickup_overdue: "orderStatus_pickup_overdue",
  ready_for_pickup: "orderStatus_ready_for_pickup",
  renting: "orderStatus_renting",
  return_inspection: "orderStatus_return_inspection",
  settling: "orderStatus_settling",
  completed: "orderStatus_completed",
  cancelled: "orderStatus_cancelled",
  no_show: "orderStatus_no_show",
} as const;

function statusLabel(
  status: string,
  translate: ReturnType<typeof useSite>["t"],
) {
  return Object.hasOwn(statusKeys, status)
    ? translate(statusKeys[status as keyof typeof statusKeys])
    : status;
}

interface OrderSummary {
  orderId?: string;
  id?: string;
  orderNo?: string;
  workspaceName?: string;
  startAt?: string;
  endAt?: string;
  finalPayableAmount?: number;
  currency?: string;
  status?: string;
}

/** 本人订单来自原会话接口，本地演示记录按租户分隔。 */
export function OrdersPage() {
  const { tenant, tenantCode, href, isRemote, localizeProduct, language, t } =
    useSite();
  const { isAuthenticated, session, currentWorkspace } = useAuth();
  const remote = isRemote && isAuthenticated;
  const en = language === "en";
  const [rows, setRows] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const identity = JSON.stringify([
    tenantCode,
    session?.customer.customerId,
    currentWorkspace?.workspaceCode,
  ]);
  const [rowsOwner, setRowsOwner] = useState(identity);
  useEffect(() => {
    setPage(1);
    setSearch("");
  }, [identity]);
  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setError("");
    setRowsOwner(identity);
    if (!remote) {
      setLoading(false);
      return;
    }
    setLoading(true);
    sessionApi
      .myOrders({ page, pageSize: 20 })
      .then((response) => {
        if (cancelled) return;
        if (
          !Array.isArray(response.items) ||
          response.items.some(
            (item) => typeof (item.orderId ?? item.id) !== "string",
          )
        )
          throw new Error(t("loadFailed"));
        setRows(response.items);
        setTotal(response.total);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [remote, identity, page, revision, t]);

  const records = remote
    ? (rowsOwner === identity ? rows : []).map((order) => ({
        id: order.orderId ?? order.id!,
        title: order.orderNo || order.orderId || order.id || "",
        cover: "",
        subtitle: order.workspaceName || "",
        start: order.startAt,
        end: order.endAt,
        amount: order.finalPayableAmount,
        currency: order.currency,
        status: order.status
          ? statusLabel(order.status, t)
          : en
            ? "Status unavailable"
            : "状态待核对",
      }))
    : siteRepository.getOrders(tenant).map((order) => {
        const raw = siteRepository.getProduct(tenant, order.productId);
        const current = raw && localizeProduct(raw);
        const snapshot = order.productSnapshot;
        const title = snapshot
          ? en
            ? snapshot.nameEn || snapshot.name
            : snapshot.name
          : current?.name || order.productId;
        return {
          id: order.id,
          title,
          cover:
            snapshot?.cover || current?.cover || "/media/image-unavailable.svg",
          subtitle: order.id,
          start: order.startDate,
          end: order.endDate,
          amount: order.rentalAmount,
          currency: order.currency ?? "CNY",
          status: en ? "Demo saved" : "演示已保存",
        };
      });
  const filtered = records.filter((order) =>
    `${order.title} ${order.subtitle} ${order.id}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );

  return (
    <MemberLayout
      active="orders"
      title={t("orders")}
      description={
        remote ? t("myRentalsRemoteDesc") : t("myRentalsDescription")
      }
    >
      {isRemote && !isAuthenticated ? (
        <PageState icon={<Receipt />} title={t("loginRequired")}>
          <Link
            className="button button-dark"
            to={href("/login?redirect=/orders")}
          >
            {t("loginCta")}
          </Link>
        </PageState>
      ) : loading ? (
        <LoadingState label={t("loading")} />
      ) : error ? (
        <PageState error title={t("loadFailed")} description={error}>
          <button
            type="button"
            className="button button-outline"
            onClick={() => setRevision(revision + 1)}
          >
            {en ? "Reload orders" : "重新加载订单"}
          </button>
        </PageState>
      ) : (
        <>
          <div className="member-section-toolbar">
            <label className="member-search">
              <span className="sr-only">
                {remote
                  ? en
                    ? "Search this page of orders"
                    : "搜索本页订单"
                  : en
                    ? "Search your bookings"
                    : "搜索预约记录"}
              </span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  en ? "Booking number or product" : "输入预约编号或商品名称"
                }
              />
            </label>
            <span role="status">
              {filtered.length} {en ? "record(s)" : "条记录"}
            </span>
          </div>
          {filtered.length ? (
            <div className="reservation-list">
              {filtered.map((order) => (
                <article className="reservation-card" key={order.id}>
                  <div className="reservation-card-top">
                    <span>{order.subtitle}</span>
                    <span className="quiet-tag">{order.status}</span>
                  </div>
                  <div className="reservation-card-main">
                    {order.cover ? (
                      <Img src={order.cover} alt="" width="800" height="800" />
                    ) : (
                      <div className="reservation-symbol">
                        <Receipt aria-hidden="true" />
                      </div>
                    )}
                    <div>
                      <h2>
                        <Link
                          to={href("/orders/" + encodeURIComponent(order.id))}
                        >
                          {order.title}
                        </Link>
                      </h2>
                      <p>
                        <Calendar aria-hidden="true" />
                        {date(order.start)} — {date(order.end)}
                      </p>
                    </div>
                    <div className="reservation-amount">
                      <span>{remote ? t("payable") : t("estimatedRent")}</span>
                      <strong>
                        {knownMoney(order.amount, order.currency) ?? "—"}
                      </strong>
                    </div>
                  </div>
                  <div className="reservation-card-actions">
                    <Link
                      className="button button-outline"
                      to={href("/orders/" + encodeURIComponent(order.id))}
                    >
                      {t("details")}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <PageState
              icon={<Receipt />}
              title={
                search
                  ? en
                    ? "No matching bookings"
                    : "未找到匹配的记录"
                  : t("noOrders")
              }
              description={
                search
                  ? en
                    ? "Try another product or booking number."
                    : "试试其他商品名称或预约编号。"
                  : t("noOrdersDescription")
              }
            >
              {search ? (
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setSearch("")}
                >
                  {en ? "Clear search" : "清空搜索"}
                </button>
              ) : (
                <Link className="button button-dark" to={href("/products")}>
                  {t("browseProducts")}
                </Link>
              )}
            </PageState>
          )}
          {remote && total > 20 && (
            <nav
              className="pagination"
              aria-label={en ? "Orders pages" : "订单分页"}
            >
              <button
                className="button button-outline"
                type="button"
                disabled={page === 1}
                onClick={() => {
                  setPage(page - 1);
                  setSearch("");
                }}
              >
                {en ? "Previous" : "上一页"}
              </button>
              <span>
                {page} / {Math.ceil(total / 20)}
              </span>
              <button
                className="button button-outline"
                type="button"
                disabled={page * 20 >= total}
                onClick={() => {
                  setPage(page + 1);
                  setSearch("");
                }}
              >
                {en ? "Next" : "下一页"}
              </button>
            </nav>
          )}
        </>
      )}
    </MemberLayout>
  );
}

/** 费用与状态读取原订单，支付由原幂等意图入口执行。 */
export function OrderDetailPage() {
  const { tenant, tenantCode, href, isRemote, localizeProduct, language, t } =
    useSite();
  const { isAuthenticated, session, currentWorkspace } = useAuth();
  const { orderId } = useParams();
  const remote = isRemote && isAuthenticated;
  const en = language === "en";
  const [revision, setRevision] = useState(0);
  const owner = useMemo(
    () => ({}),
    [
      remote,
      tenantCode,
      orderId,
      session,
      currentWorkspace?.workspaceCode,
      revision,
    ],
  );
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const [record, setRecord] = useState<{
    owner: object;
    order: ClientOrderView;
  } | null>(null);
  const order = record?.owner === owner ? record.order : null;
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState("");
  const [methods, setMethods] = useState<string[]>([]);
  const [payNote, setPayNote] = useState("");
  const [payError, setPayError] = useState(false);
  const [payUrl, setPayUrl] = useState("");
  const [paying, setPaying] = useState(false);
  const paymentBusy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setMethods([]);
    setPayNote("");
    setPayUrl("");
    setPayError(false);
    setError("");
    setPaying(false);
    if (!remote || !orderId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      sessionApi.order(orderId),
      sessionApi.paymentCapabilities().catch(() => null),
    ])
      .then(([value, caps]) => {
        if (cancelled) return;
        if (
          value.id !== orderId ||
          !Array.isArray(value.lines) ||
          !Array.isArray(value.chargeLines)
        )
          throw new Error(t("loadFailed"));
        setRecord({ owner, order: value as unknown as ClientOrderView });
        if (caps?.realPaymentEnabled === true && Array.isArray(caps.methods)) {
          setMethods(
            caps.methods.filter(
              (method) => method === "alipay" || method === "wechat_pay",
            ),
          );
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, t]);

  async function pay(method: string) {
    if (!orderId || !order || paymentBusy.current || !methods.includes(method))
      return;
    const operationOwner = owner;
    paymentBusy.current = true;
    setPaying(true);
    setPayNote("");
    setPayUrl("");
    setPayError(false);
    try {
      const result = await sessionApi.createPaymentIntent(
        orderId,
        { instrument: "rental", method },
        `pay-${orderId}-${method}`,
      );
      if (currentOwner.current !== operationOwner) return;
      const intent = result as ClientPaymentIntentResponse;
      if (!intent.intentId || intent.instrument !== "rental")
        throw new Error(t("paymentFailed"));
      const url = intent.checkoutUrl;
      if (
        typeof url === "string" &&
        safeDocumentHref(url) &&
        (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url))
      )
        setPayUrl(url);
      setPayNote(intent.message || t("paymentCreated"));
    } catch (e) {
      if (currentOwner.current === operationOwner) {
        setPayError(true);
        setPayNote(e instanceof Error ? e.message : t("paymentFailed"));
      }
    } finally {
      paymentBusy.current = false;
      if (currentOwner.current === operationOwner) setPaying(false);
    }
  }

  const demo = !isRemote
    ? siteRepository.getOrders(tenant).find((item) => item.id === orderId)
    : undefined;
  const rawProduct = demo && siteRepository.getProduct(tenant, demo.productId);
  const currentProduct = rawProduct && localizeProduct(rawProduct);
  const snapshot = demo?.productSnapshot;
  const productName = snapshot
    ? en
      ? snapshot.nameEn || snapshot.name
      : snapshot.name
    : currentProduct?.name || demo?.productId || "";
  const productSubtitle = snapshot
    ? en
      ? snapshot.subtitleEn || snapshot.subtitle
      : snapshot.subtitle
    : currentProduct?.subtitle || "";
  const productCover =
    snapshot?.cover || currentProduct?.cover || "/media/image-unavailable.svg";
  const currency = remote ? order?.currency : (demo?.currency ?? "CNY");
  const facts = order ? customerOrderFacts(order, orderId ?? "") : null;
  const title = isRemote
    ? order?.orderNo || (en ? "Rental details" : "订单详情")
    : demo
      ? t("savedTitle")
      : t("missingOrder");
  const businessIdentity = JSON.stringify([
    tenantCode,
    orderId,
    session?.customer.customerId,
    currentWorkspace?.workspaceCode,
  ]);

  return (
    <div className="shell order-page">
      <Breadcrumbs
        items={[
          { label: t("home"), to: href("/") },
          { label: t("orders"), to: href("/orders") },
          { label: title },
        ]}
      />
      {isRemote && !isAuthenticated ? (
        <PageState heading="h1" icon={<Receipt />} title={t("loginRequired")}>
          <Link
            className="button button-dark"
            to={href(
              "/login?redirect=" + encodeURIComponent("/orders/" + orderId),
            )}
          >
            {t("loginCta")}
          </Link>
        </PageState>
      ) : loading || (remote && !order && !error) ? (
        <LoadingState label={t("loading")} />
      ) : error ? (
        <PageState
          heading="h1"
          error
          title={t("loadFailed")}
          description={error}
        >
          <button
            type="button"
            className="button button-outline"
            onClick={() => setRevision(revision + 1)}
          >
            {en ? "Reload order" : "重新加载订单"}
          </button>
        </PageState>
      ) : remote ? (
        order && (
          <>
            <PageHeading
              title={title}
              description={statusLabel(order.status, t)}
            />
            <div className="order-detail-layout">
              <div>
                <section className="order-section">
                  <h2>
                    <Receipt aria-hidden="true" />
                    {t("bookingInfo")}
                  </h2>
                  <div className="order-item-list">
                    {order.lines.map((line) => (
                      <div key={line.id}>
                        <span>
                          {line.itemGroupName || line.itemGroupId} ×{" "}
                          {line.quantity}
                        </span>
                        <strong>
                          {knownMoney(line.amount, currency) ?? "—"}
                        </strong>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="order-section">
                  <h2>
                    <Calendar aria-hidden="true" />
                    {t("rentalDate")}
                  </h2>
                  <dl className="spec-list">
                    <div>
                      <dt>{t("startDate")}</dt>
                      <dd>{date(order.startAt)}</dd>
                    </div>
                    <div>
                      <dt>{t("endDate")}</dt>
                      <dd>{date(order.effectiveEndAt || order.endAt)}</dd>
                    </div>
                  </dl>
                </section>
                <section className="order-section">
                  <h2>
                    <Store aria-hidden="true" />
                    {t("pickupDelivery")}
                  </h2>
                  <dl className="spec-list">
                    <div>
                      <dt>{en ? "Fulfillment" : "履约方式"}</dt>
                      <dd>{order.fulfillmentMode || "—"}</dd>
                    </div>
                    <div>
                      <dt>{en ? "Pickup store" : "取货门店"}</dt>
                      <dd>{order.fulfillmentLocationName || "—"}</dd>
                    </div>
                    {order.returnLocationName && (
                      <div>
                        <dt>{en ? "Return store" : "归还门店"}</dt>
                        <dd>{order.returnLocationName}</dd>
                      </div>
                    )}
                    {order.deliveryAddress && (
                      <div>
                        <dt>{en ? "Delivery address" : "配送地址"}</dt>
                        <dd>
                          {[
                            order.deliveryAddress.province,
                            order.deliveryAddress.city,
                            order.deliveryAddress.district,
                            order.deliveryAddress.detail,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          <br />
                          {order.deliveryAddress.recipient}{" "}
                          {order.deliveryAddress.phoneMasked}
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>
                {facts && (
                  <details className="original-order-facts">
                    <summary>
                      {en ? "Original order facts" : "原订单事实"}
                    </summary>
                    <dl className="spec-list">
                      <div>
                        <dt>{en ? "Receivable" : "应收"}</dt>
                        <dd>{facts.receivable}</dd>
                      </div>
                      <div>
                        <dt>{en ? "Received" : "实收"}</dt>
                        <dd>{facts.paid}</dd>
                      </div>
                      <div>
                        <dt>{en ? "Deposit requirement" : "押金要求"}</dt>
                        <dd>{facts.deposit}</dd>
                      </div>
                      <div>
                        <dt>
                          {en ? "Preauthorization requirement" : "预授权要求"}
                        </dt>
                        <dd>{facts.preAuth}</dd>
                      </div>
                      <div>
                        <dt>{en ? "Refund" : "退款"}</dt>
                        <dd>{facts.refundStatus}</dd>
                      </div>
                      <div>
                        <dt>{en ? "Source" : "来源"}</dt>
                        <dd>
                          {facts.sourceId} / {facts.updatedAt}
                        </dd>
                      </div>
                    </dl>
                    <p>{facts.note}</p>
                  </details>
                )}
              </div>
              <aside className="order-cost">
                <h2>
                  <Payment aria-hidden="true" />
                  {t("payable")}
                </h2>
                <dl>
                  {order.chargeLines.length ? (
                    order.chargeLines.map((charge, index) => (
                      <div key={index}>
                        <dt>{charge.name || charge.type}</dt>
                        <dd>{knownMoney(charge.amount, currency) ?? "—"}</dd>
                      </div>
                    ))
                  ) : (
                    <div>
                      <dt>{t("rentAmount")}</dt>
                      <dd>{knownMoney(order.rentalAmount, currency) ?? "—"}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t("deposit")}</dt>
                    <dd>{knownMoney(order.depositAmount, currency) ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("preAuth")}</dt>
                    <dd>{knownMoney(order.preAuthAmount, currency) ?? "—"}</dd>
                  </div>
                  <div className="order-cost-total">
                    <dt>{t("payable")}</dt>
                    <dd>
                      {knownMoney(order.finalPayableAmount, currency) ?? "—"}
                    </dd>
                  </div>
                </dl>
                <h3>{t("payTitle")}</h3>
                {methods.length ? (
                  <div className="payment-actions">
                    {methods.map((method) => (
                      <button
                        key={method}
                        type="button"
                        className="button button-dark"
                        disabled={paying}
                        onClick={() => {
                          void pay(method);
                        }}
                      >
                        {method === "alipay" ? t("payAlipay") : t("payWechat")}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>{t("payUnavailable")}</p>
                )}
                {payNote && (
                  <p
                    className={payError ? "form-error" : "field-note"}
                    role={payError ? "alert" : "status"}
                  >
                    {payNote}
                  </p>
                )}
                {payUrl && (
                  <a
                    className="button button-dark button-block"
                    href={payUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("payGo")}
                  </a>
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={paying}
                  onClick={() => setRevision(revision + 1)}
                >
                  {en ? "Refresh original order" : "刷新原订单状态"}
                </button>
                <p>{t("paySettleNote")}</p>
              </aside>
            </div>
            {orderId && session?.customer.customerType === "personal" && (
              <div className="order-assistance">
                <ClientTaskWorkbench
                  orderId={orderId}
                  scopeKey={JSON.stringify([
                    tenantCode,
                    session.customer.customerId,
                    currentWorkspace?.workspaceCode,
                    orderId,
                    revision,
                  ])}
                  english={en}
                />
                <EnterpriseExtensionApproval
                  key={"extension" + businessIdentity}
                  orderId={orderId}
                  identity={businessIdentity}
                  english={en}
                />
                <EnterpriseExchangeRequest
                  key={"request" + businessIdentity}
                  orderId={orderId}
                  allowNewRequest={order.status === "renting"}
                  identity={businessIdentity}
                  english={en}
                />
                <EnterpriseExchangeProgress
                  key={"progress" + businessIdentity}
                  orderId={orderId}
                  identity={businessIdentity}
                  english={en}
                />
              </div>
            )}
            <div className="order-bottom-actions">
              <Link className="button button-outline" to={href("/orders")}>
                {t("returnOrders")}
              </Link>
              <Link className="button button-dark" to={href("/products")}>
                {t("continueExplore")}
              </Link>
            </div>
          </>
        )
      ) : demo ? (
        <>
          <PageHeading
            title={title}
            description={t("orderNumber") + " " + demo.id}
          />
          <p className="preview-notice">{t("savedDescription")}</p>
          <div className="order-detail-layout">
            <div>
              <section className="order-section">
                <h2>
                  <Receipt aria-hidden="true" />
                  {t("bookingInfo")}
                </h2>
                <div className="booking-product">
                  <Img src={productCover} alt="" width="800" height="800" />
                  <div>
                    <strong>{productName}</strong>
                    <p>{productSubtitle}</p>
                  </div>
                </div>
              </section>
              <section className="order-section">
                <h2>
                  <Calendar aria-hidden="true" />
                  {t("rentalDate")}
                </h2>
                <dl className="spec-list">
                  <div>
                    <dt>{t("startDate")}</dt>
                    <dd>{date(demo.startDate)}</dd>
                  </div>
                  <div>
                    <dt>{t("endDate")}</dt>
                    <dd>{date(demo.endDate)}</dd>
                  </div>
                  <div>
                    <dt>{t("rentalQuantity")}</dt>
                    <dd>
                      {demo.quantity} {t("itemUnit")}
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="order-section">
                <h2>
                  <Store aria-hidden="true" />
                  {t("pickupDelivery")}
                </h2>
                <dl className="spec-list">
                  <div>
                    <dt>{t("pickupDelivery")}</dt>
                    <dd>
                      {demo.fulfillment === "pickup"
                        ? t("pickup")
                        : en
                          ? "Delivery"
                          : "配送"}
                    </dd>
                  </div>
                  {demo.pickupStoreId && (
                    <div>
                      <dt>{en ? "Pickup store" : "取货门店"}</dt>
                      <dd>
                        {tenant.stores?.find(
                          (store) => store.id === demo.pickupStoreId,
                        )?.name || demo.pickupStoreId}
                      </dd>
                    </div>
                  )}
                  {demo.returnStoreId && (
                    <div>
                      <dt>{en ? "Return store" : "归还门店"}</dt>
                      <dd>
                        {tenant.stores?.find(
                          (store) => store.id === demo.returnStoreId,
                        )?.name || demo.returnStoreId}
                      </dd>
                    </div>
                  )}
                  {demo.deliveryAddress && (
                    <div>
                      <dt>{en ? "Demo delivery address" : "演示配送地址"}</dt>
                      <dd>{demo.deliveryAddress}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t("contactPerson")}</dt>
                    <dd>{demo.contactName}</dd>
                  </div>
                  <div>
                    <dt>{t("contactPhone")}</dt>
                    <dd>{demo.contactPhone || "—"}</dd>
                  </div>
                  {demo.note && (
                    <div>
                      <dt>{en ? "Note" : "备注"}</dt>
                      <dd>{demo.note}</dd>
                    </div>
                  )}
                </dl>
              </section>
            </div>
            <aside className="order-cost">
              <h2>
                <Payment aria-hidden="true" />
                {t("costConfirm")}
              </h2>
              <dl>
                <div>
                  <dt>{t("estimatedRent")}</dt>
                  <dd>{knownMoney(demo.rentalAmount, currency) ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t("referenceDeposit")}</dt>
                  <dd>{knownMoney(demo.depositAmount, currency) ?? "—"}</dd>
                </div>
                <div className="order-cost-total">
                  <dt>{t("totalEstimated")}</dt>
                  <dd>
                    {knownMoney(
                      demo.rentalAmount + demo.depositAmount,
                      currency,
                    ) ?? "—"}
                  </dd>
                </div>
              </dl>
              <p>{t("feeNote")}</p>
            </aside>
          </div>
          <div className="order-bottom-actions">
            <Link className="button button-outline" to={href("/orders")}>
              {t("returnOrders")}
            </Link>
            <Link className="button button-dark" to={href("/products")}>
              {t("continueExplore")}
            </Link>
          </div>
        </>
      ) : (
        <PageState heading="h1" icon={<Receipt />} title={t("missingOrder")}>
          <Link className="button button-dark" to={href("/orders")}>
            {t("returnOrders")}
          </Link>
        </PageState>
      )}
    </div>
  );
}

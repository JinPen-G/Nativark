import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type {
  ClientDeliveryAddressRequest,
  ClientDeliveryAddressView,
} from "@rental-os/shared";
import { Address, Bell, Plus, Ticket, Trash } from "../components/SiteIcon";
import { MemberLayout, type MemberSection } from "../components/MemberLayout";
import { LoadingState, PageState } from "../components/PageState";
import { useSite } from "../SiteContext";
import { useAuth } from "../AuthContext";
import { useToast } from "../components/Toast";
import {
  captureOwnProfileReadSession,
  sessionApi,
  subscribeCustomerSession,
  type OwnProfileReadView,
} from "../data/authClient";

const emptyAddress: ClientDeliveryAddressRequest = {
  recipient: "",
  phone: "",
  province: "",
  city: "",
  district: "",
  detail: "",
  isDefault: false,
};

/** Original personal profile GET in the existing account page. Only current
 * returned fields are shown; hiding, session changes or failed rereads retire
 * the previous response. No profile form or write operation is installed. */
function OwnProfile({ demo }: { demo: boolean }) {
  const { tenantCode, language } = useSite(),
    { session, currentWorkspace } = useAuth(),
    en = language === "en";
  const owner = useMemo(
    () => ({}),
    [demo, tenantCode, session, currentWorkspace?.workspaceCode],
  );
  const lifetime = useRef({ owner, mounted: false, epoch: 0 });
  lifetime.current.owner = owner;
  const request = useRef<AbortController | null>(null),
    identity = useRef<ReturnType<typeof captureOwnProfileReadSession>>(null);
  const [record, setRecord] = useState<{
    owner: object;
    loading: boolean;
    failed: boolean;
    profile: OwnProfileReadView | null;
  } | null>(null);
  const clear = () => {
    lifetime.current.epoch++;
    request.current?.abort();
    request.current = null;
    identity.current = null;
    if (lifetime.current.mounted && lifetime.current.owner === owner)
      setRecord(null);
  };
  const read = async () => {
    if (
      demo ||
      !tenantCode ||
      !lifetime.current.mounted ||
      lifetime.current.owner !== owner ||
      document.hidden ||
      request.current
    )
      return;
    const captured = captureOwnProfileReadSession();
    if (!captured?.current() || captured.tenantCode !== tenantCode) {
      clear();
      setRecord({ owner, loading: false, failed: true, profile: null });
      return;
    }
    const controller = new AbortController(),
      epoch = ++lifetime.current.epoch;
    request.current = controller;
    identity.current = captured;
    const current = () =>
      lifetime.current.mounted &&
      lifetime.current.owner === owner &&
      lifetime.current.epoch === epoch &&
      !document.hidden &&
      !controller.signal.aborted &&
      captured.current();
    setRecord({ owner, loading: true, failed: false, profile: null });
    try {
      const profile = await sessionApi.profile(controller.signal);
      if (!current()) return;
      if (
        profile.customerId !== captured.customerId ||
        profile.workspace.workspaceCode !== captured.workspaceCode
      )
        throw Error("own_profile_changed");
      setRecord({ owner, loading: false, failed: false, profile });
    } catch {
      if (current())
        setRecord({ owner, loading: false, failed: true, profile: null });
    } finally {
      if (request.current === controller) request.current = null;
      if (
        lifetime.current.mounted &&
        lifetime.current.owner === owner &&
        lifetime.current.epoch === epoch &&
        !current()
      )
        clear();
    }
  };
  useEffect(() => {
    lifetime.current.mounted = true;
    clear();
    const hidden = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", clear);
    const unsubscribe = tenantCode
      ? subscribeCustomerSession(tenantCode, clear)
      : () => undefined;
    void read();
    return () => {
      lifetime.current.mounted = false;
      lifetime.current.epoch++;
      request.current?.abort();
      request.current = null;
      identity.current = null;
      unsubscribe();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", clear);
    };
  }, [owner]);
  const shown =
    record?.owner === owner &&
    !document.hidden &&
    (!record.profile || identity.current?.current())
      ? record
      : null;
  const profile = shown?.profile;
  const text = (value: string) =>
    value.replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu,
      "",
    );
  const statuses = {
    active: en ? "Active" : "正常",
    suspended: en ? "Suspended" : "已停用",
    closed: en ? "Closed" : "已关闭",
  };
  return (
    <section
      className="member-section"
      aria-label={en ? "My profile" : "本人资料"}
      aria-busy={!!shown?.loading}
      style={{ minWidth: 0 }}
    >
      <div className="member-section-toolbar">
        <p>
          {en
            ? "Your records with this merchant. This section is read only."
            : "以下为你在当前商户的资料，此区域仅供查看。"}
        </p>
        <button
          type="button"
          className="button button-outline"
          disabled={demo || !!shown?.loading || document.hidden}
          onClick={() => void read()}
        >
          {en ? "Read my profile" : "读取本人资料"}
        </button>
      </div>
      {demo ? (
        <p className="field-note">
          {en
            ? "Sign in to a real merchant to view your profile."
            : "在真实商户下登录后可查看本人资料。"}
        </p>
      ) : shown?.loading ? (
        <LoadingState
          label={en ? "Reading your profile" : "正在读取本人资料"}
        />
      ) : shown?.failed ? (
        <PageState
          error
          title={en ? "Profile unavailable" : "本人资料暂不可读取"}
          description={
            en
              ? "Read again after checking your current session."
              : "请核对当前登录身份后重新读取。"
          }
        />
      ) : profile ? (
        <dl className="spec-list" style={{ overflowWrap: "anywhere" }}>
          <div>
            <dt>{en ? "Name" : "姓名"}</dt>
            <dd>{text(profile.name)}</dd>
          </div>
          <div>
            <dt>{en ? "Phone" : "电话"}</dt>
            <dd>{text(profile.phoneMasked)}</dd>
          </div>
          <div>
            <dt>{en ? "Email" : "邮箱"}</dt>
            <dd>
              {profile.email
                ? text(profile.email)
                : en
                  ? "Not provided"
                  : "未提供"}
            </dd>
          </div>
          {profile.identityNoMasked && (
            <div>
              <dt>{en ? "Identity document" : "证件"}</dt>
              <dd>{text(profile.identityNoMasked)}</dd>
            </div>
          )}
          <div>
            <dt>{en ? "Identity verification" : "证件核验"}</dt>
            <dd>
              {profile.identityVerified
                ? en
                  ? "Verified"
                  : "已核验"
                : en
                  ? "Not verified"
                  : "未核验"}
            </dd>
          </div>
          <div>
            <dt>{en ? "Account status" : "账号状态"}</dt>
            <dd>{statuses[profile.accountStatus]}</dd>
          </div>
          <div>
            <dt>{en ? "Current service" : "当前服务"}</dt>
            <dd>{text(profile.workspace.workspaceName)}</dd>
          </div>
        </dl>
      ) : (
        <p className="field-note">
          {en
            ? "Read your current profile to view it here."
            : "请读取当前本人资料。"}
        </p>
      )}
    </section>
  );
}

function AddressBook({ demo }: { demo: boolean }) {
  const { t, language } = useSite();
  const en = language === "en";
  const toast = useToast();
  const [items, setItems] = useState<ClientDeliveryAddressView[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [form, setForm] = useState<ClientDeliveryAddressRequest>(emptyAddress);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const readVersion = useRef(0);
  const formHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readVersion.current++;
    };
  }, []);

  const reload = useCallback(async () => {
    if (demo) {
      setItems([]);
      setLoading(false);
      return;
    }
    const version = ++readVersion.current;
    setLoading(true);
    setError("");
    try {
      const response = await sessionApi.addresses();
      if (mounted.current && version === readVersion.current) {
        if (!Array.isArray(response.items)) throw new Error(t("loadFailed"));
        setItems(response.items as ClientDeliveryAddressView[]);
      }
    } catch (e) {
      if (mounted.current && version === readVersion.current)
        setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      if (mounted.current && version === readVersion.current) setLoading(false);
    }
  }, [demo, t]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (adding) formHeading.current?.focus();
  }, [adding]);

  function edit(item: ClientDeliveryAddressView) {
    setForm({
      id: item.id,
      revision: item.revision,
      recipient: item.recipient,
      phone: "",
      countryCode: item.countryCode,
      province: item.province,
      city: item.city,
      district: item.district,
      detail: item.detail,
      postalCode: item.postalCode,
      latitude: item.latitude,
      longitude: item.longitude,
      isDefault: item.isDefault,
    });
    setAdding(true);
    setError("");
    setDeleting(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (demo || pending.current) return;
    if (
      !form.recipient.trim() ||
      !form.phone.trim() ||
      !form.province.trim() ||
      !form.city.trim() ||
      !form.detail.trim()
    ) {
      setError(
        en
          ? "Complete the recipient, phone and delivery address."
          : "请填写收件人、联系电话与完整地址。",
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await sessionApi.saveAddress(form);
      if (!mounted.current) return;
      setForm(emptyAddress);
      setAdding(false);
      toast.success(t("addressSaved"));
      await reload();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function remove(id: string) {
    if (demo || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await sessionApi.deleteAddress(id);
      if (!mounted.current) return;
      setDeleting(null);
      toast.success(t("addressDeleted"));
      await reload();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : t("deleteFailed"));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="member-section">
      <div className="member-section-toolbar">
        <p>{en ? "For your delivery arrangements." : "用于配送与取还安排。"}</p>
        <button
          type="button"
          className="button button-outline"
          disabled={busy}
          aria-expanded={adding}
          aria-controls="address-form"
          onClick={() => {
            setForm(emptyAddress);
            setAdding(!adding);
            setError("");
            setDeleting(null);
          }}
        >
          <Plus aria-hidden="true" />
          {adding ? (en ? "Close form" : "收起表单") : t("addAddress")}
        </button>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              void reload();
            }}
          >
            {en ? "Reload addresses" : "重新加载地址"}
          </button>
        </div>
      )}
      {adding && (
        <form
          className="address-form"
          id="address-form"
          onSubmit={save}
          aria-busy={busy}
        >
          <h2 tabIndex={-1} ref={formHeading}>
            {form.id ? (en ? "Edit address" : "编辑地址") : t("addAddress")}
          </h2>
          <fieldset disabled={busy} className="form-fieldset">
            <div className="form-grid">
              <label>
                {t("addrRecipient")}
                <input
                  required
                  autoComplete="shipping name"
                  value={form.recipient}
                  maxLength={120}
                  onChange={(e) =>
                    setForm({ ...form, recipient: e.target.value })
                  }
                />
              </label>
              <label>
                {t("addrPhone")}
                <input
                  required
                  type="tel"
                  autoComplete="shipping tel"
                  value={form.phone}
                  maxLength={32}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label>
                {t("addrProvince")}
                <input
                  required
                  autoComplete="shipping address-level1"
                  value={form.province}
                  maxLength={64}
                  onChange={(e) =>
                    setForm({ ...form, province: e.target.value })
                  }
                />
              </label>
              <label>
                {t("addrCity")}
                <input
                  required
                  autoComplete="shipping address-level2"
                  value={form.city}
                  maxLength={64}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </label>
              <label>
                {t("addrDistrict")}
                <input
                  autoComplete="shipping address-level3"
                  value={form.district || ""}
                  maxLength={64}
                  onChange={(e) =>
                    setForm({ ...form, district: e.target.value })
                  }
                />
              </label>
            </div>
            <label className="full-field">
              {t("addrDetail")}
              <input
                required
                autoComplete="shipping street-address"
                value={form.detail}
                maxLength={255}
                onChange={(e) => setForm({ ...form, detail: e.target.value })}
              />
            </label>
            <label className="login-agree">
              <input
                type="checkbox"
                checked={Boolean(form.isDefault)}
                onChange={(e) =>
                  setForm({ ...form, isDefault: e.target.checked })
                }
              />
              <span>{t("addrDefault")}</span>
            </label>
            {form.id && (
              <p className="field-note">
                {en
                  ? "Enter the full phone number to confirm this address update."
                  : "修改地址时请填写完整联系电话，以便核对。"}
              </p>
            )}
            <div className="form-actions">
              <button
                type="submit"
                className="button button-dark"
                disabled={demo}
              >
                {busy ? t("saving") : t("save")}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setAdding(false);
                  setForm(emptyAddress);
                }}
              >
                {en ? "Cancel" : "取消"}
              </button>
            </div>
          </fieldset>
          {demo && (
            <p className="field-note">
              {en
                ? "Try the address form here. Sign in to a live tenant to save an address."
                : "这里可体验地址表单，登录真实租户后可保存地址。"}
            </p>
          )}
        </form>
      )}
      {loading ? (
        <LoadingState label={t("loading")} />
      ) : items.length ? (
        <ul className="member-addresses">
          {items.map((item) => (
            <li key={item.id}>
              <Address aria-hidden="true" />
              <div>
                <h2>
                  {item.recipient}
                  <span>{item.phoneMasked}</span>
                </h2>
                <p>
                  {[item.province, item.city, item.district, item.detail]
                    .filter(Boolean)
                    .join(" ")}
                </p>
                {item.isDefault && (
                  <span className="quiet-tag">{t("addrDefault")}</span>
                )}
                {deleting === item.id && (
                  <div className="delete-confirmation">
                    <p>
                      {en
                        ? "Delete this address from your address book?"
                        : "从地址簿删除这个地址？"}
                    </p>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        void remove(item.id);
                      }}
                    >
                      {en ? "Confirm delete" : "确认删除"}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => setDeleting(null)}
                    >
                      {en ? "Cancel" : "取消"}
                    </button>
                  </div>
                )}
              </div>
              <div className="address-actions">
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => edit(item)}
                >
                  {en ? "Edit" : "编辑"}
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleting(item.id)}
                  aria-label={`${t("delete")} ${item.recipient}`}
                >
                  <Trash aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !error &&
        !adding && (
          <PageState
            icon={<Address />}
            title={t("addressEmpty")}
            description={
              en
                ? "Add an address when you need delivery."
                : "需要配送时，可以添加常用地址。"
            }
          />
        )
      )}
    </section>
  );
}

type CollectionItem = {
  id?: string;
  name?: string;
  title?: string;
  templateName?: string;
  description?: string;
  content?: string;
  body?: string;
  message?: string;
  rule?: string;
  expiresAt?: string;
  createdAt?: string;
};

function AccountCollection({
  kind,
  demo,
}: {
  kind: "coupons" | "notifications";
  demo: boolean;
}) {
  const { t, language } = useSite();
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const en = language === "en";
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setError("");
    if (demo) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const request =
      kind === "coupons"
        ? sessionApi.coupons()
        : sessionApi.notifications({ page: 1, pageSize: 20 });
    request
      .then((response) => {
        if (cancelled) return;
        const rows = Array.isArray(response) ? response : response.items;
        if (!Array.isArray(rows)) throw new Error(t("loadFailed"));
        setItems(rows);
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
  }, [kind, demo, revision, t]);
  if (loading) return <LoadingState label={t("loading")} />;
  if (error)
    return (
      <PageState error title={t("loadFailed")} description={error}>
        <button
          type="button"
          className="button button-outline"
          onClick={() => setRevision(revision + 1)}
        >
          {en ? "Try again" : "重试"}
        </button>
      </PageState>
    );
  if (!items.length)
    return (
      <PageState
        icon={kind === "coupons" ? <Ticket /> : <Bell />}
        title={kind === "coupons" ? t("couponsEmpty") : t("notificationsEmpty")}
      />
    );
  return (
    <ul className={kind === "coupons" ? "member-coupons" : "member-notices"}>
      {items.map((item, index) => (
        <li key={item.id ?? index}>
          {kind === "coupons" ? (
            <Ticket aria-hidden="true" />
          ) : (
            <Bell aria-hidden="true" />
          )}
          <div>
            <h2>
              {item.name ||
                item.title ||
                item.templateName ||
                (kind === "coupons" ? t("coupon") : t("notification"))}
            </h2>
            <p>
              {item.description ||
                item.content ||
                item.body ||
                item.message ||
                item.rule ||
                ""}
            </p>
            {kind === "coupons" && item.expiresAt && (
              <small>
                {t("couponExpires", { date: item.expiresAt.slice(0, 10) })}
              </small>
            )}
            {kind === "notifications" && item.createdAt && (
              <time dateTime={item.createdAt}>
                {item.createdAt.slice(0, 16).replace("T", " ")}
              </time>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 账户操作由原客户会话授权，演示模式只提供表单和空状态预览。 */
export function AccountPage() {
  const { href, isRemote, tenantCode, t, language } = useSite();
  const { isAuthenticated, session, currentWorkspace } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const active: MemberSection =
    params.get("section") === "profile"
      ? "profile"
      : params.get("section") === "coupons"
        ? "coupons"
        : params.get("section") === "notifications"
          ? "notifications"
          : "addresses";
  const identity = JSON.stringify([
    tenantCode,
    session?.customer.customerId,
    currentWorkspace?.workspaceCode,
  ]);
  useEffect(() => {
    if (isRemote && !isAuthenticated)
      navigate(
        href("/login?redirect=" + encodeURIComponent("/account?" + params)),
        { replace: true },
      );
  }, [isRemote, isAuthenticated, params]);
  if (isRemote && !isAuthenticated)
    return (
      <div className="shell simple-page">
        <PageState title={t("loginRequired")}>
          <Link className="button button-dark" to={href("/login")}>
            {t("loginCta")}
          </Link>
        </PageState>
      </div>
    );
  return (
    <MemberLayout
      active={active}
      title={
        active === "profile"
          ? language === "en"
            ? "My profile"
            : "本人资料"
          : active === "addresses"
            ? t("addressBook")
            : active === "coupons"
              ? t("coupons")
              : t("notifications")
      }
      description={t("accountSubtitle")}
    >
      {active === "profile" ? (
        <OwnProfile key={identity} demo={!isRemote} />
      ) : active === "addresses" ? (
        <AddressBook key={identity} demo={!isRemote} />
      ) : (
        <AccountCollection
          key={active + identity}
          kind={active}
          demo={!isRemote}
        />
      )}
    </MemberLayout>
  );
}

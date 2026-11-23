import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader } from "../components/SiteIcon";
import { PageHeading } from "../components/PageHeader";
import { Img } from "../components/Img";
import { useSite } from "../SiteContext";
import { useAuth } from "../AuthContext";
import { authApi } from "../data/authClient";
import { websiteTransientStorage } from "../host";
import { useToast } from "../components/Toast";
import { safeDocumentHref } from "@rental-os/shared";
import {
  parseEnterpriseRoute,
  safeCustomerReturn,
} from "@rental-os/web-client";

// 登录与注册是两件事、两个入口：登录页只留「验证码 / 密码」两种登录方式，
// 注册是登录卡下方「还没有账号？去注册」切到的独立视图（含「已有账号？去登录」返回）。
// 已验证注册的完整输入仅驻留当前页面；失应答重试原提交，证明和密码不进入存储。
// 短信登录没有原会话回放接口；派发后不重新验证原挑战，迟到结果不采用会话。
type View = "login" | "register";
type LoginMode = "sms" | "password";

function phoneValid(phone: string) {
  return /^1\d{10}$/.test(phone.trim());
}

// 只存原请求键，不存验证码或证明。读取失败保留原意图，不新建请求。
function readChallengeKey(scope: string): string | null {
  let stored: string | null;
  try { stored = websiteTransientStorage().getItem(scope); }
  catch { throw new Error("challenge_reference_unavailable"); }
  if (stored !== null && (!stored.trim() || stored.length > 191))
    throw new Error("challenge_reference_unavailable");
  return stored;
}

export function LoginPage() {
  const {
    tenantCode,
    isRemote,
    href,
    t,
    enterpriseDomainBound,
    tenant,
    language,
    bootstrap,
  } = useSite();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const domainBound = enterpriseDomainBound;
  const redirect =
    safeCustomerReturn(params.get("redirect"), tenantCode ?? "", domainBound) ??
    "/orders";
  const returnToTarget = () => {
    if (parseEnterpriseRoute(redirect)) window.location.assign(redirect);
    else navigate(href(redirect), { replace: true });
  };
  const en = language === "en";
  const [passwordVisible, setPasswordVisible] = useState(false);

  const view: View = params.get("view") === "register" ? "register" : "login";
  const [loginMode, setLoginMode] = useState<LoginMode>("sms");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [hasChallengeRequest, setHasChallengeRequest] = useState(false);
  const challengeExpiry = useRef<string | null>(null);
  const active = useRef(true);
  const operationPending = useRef(false);
  const scope = `rental-os:website-challenge:${JSON.stringify([tenantCode, view, phone.trim()])}`;
  const pageScope = JSON.stringify([scope, view === "login" ? loginMode : view, redirect]);
  const requestContext = useRef({ scope: pageScope, generation: 0 });
  if (requestContext.current.scope !== pageScope)
    requestContext.current = { scope: pageScope, generation: requestContext.current.generation + 1 };
  const timer = useRef<number | null>(null);
  const registrationKey = useRef<string | null>(null);
  const registrationRequest = useRef<{ scope: string; generation: number; input: Parameters<typeof authApi.register>[0] } | null>(null);
  const submittedSmsChallenge = useRef<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) returnToTarget();
  }, [isAuthenticated]);
  useEffect(
    () => {
      active.current = true;
      return () => {
        active.current = false;
        requestContext.current.generation++;
        registrationRequest.current = null;
        registrationKey.current = null;
        submittedSmsChallenge.current = null;
        if (timer.current) window.clearInterval(timer.current);
      };
    },
    [],
  );

  const isRegister = view === "register";
  const needsCode = isRegister || loginMode === "sms";
  const methods = isRemote
    ? (bootstrap?.loginMethods ?? [])
    : ["sms", "password"];
  const userAgreement = bootstrap?.agreements?.userAgreement;
  const privacyPolicy = bootstrap?.agreements?.privacyPolicy;
  const canRegister =
    bootstrap?.tenantCode === tenantCode &&
    methods.includes("sms") &&
    Boolean(userAgreement?.version && privacyPolicy?.version) &&
    Boolean(
      userAgreement?.hasBody ||
      (userAgreement?.url && safeDocumentHref(userAgreement.url)),
    ) &&
    Boolean(
      privacyPolicy?.hasBody ||
      (privacyPolicy?.url && safeDocumentHref(privacyPolicy.url)),
    );
  const canLogin = methods.includes(loginMode);
  useEffect(() => {
    if (!methods.includes(loginMode))
      setLoginMode(methods.includes("sms") ? "sms" : "password");
  }, [bootstrap, loginMode]);
  useEffect(() => {
    setPhone("");
    setPassword("");
    setName("");
    setCode("");
    setChallengeId(null);
    setDevCode(null);
    setAgree(false);
    setError("");
    setPending(false);
    setCountdown(0);
    registrationKey.current = null;
    if (timer.current) window.clearInterval(timer.current);
  }, [tenantCode]);
  useEffect(() => {
    registrationRequest.current = null;
    registrationKey.current = null;
    submittedSmsChallenge.current = null;
    setChallengeId(null);
    challengeExpiry.current = null;
    setDevCode(null);
    setCode("");
    setCountdown(0);
    if (timer.current) window.clearInterval(timer.current);
    try {
      setHasChallengeRequest(Boolean(tenantCode && phoneValid(phone) && readChallengeKey(scope)));
    } catch {
      setHasChallengeRequest(true);
      setError(en ? "The original code request could not be read. Check storage access before continuing."
        : "原验证码请求无法读取，请恢复存储访问后继续。");
    }
  }, [scope]);
  function switchView(next: View) {
    const query = new URLSearchParams(params);
    if (next === "register") query.set("view", "register");
    else query.delete("view");
    navigate(href("/login?" + query));
    setError("");
    setCode("");
    setChallengeId(null);
    setDevCode(null);
    if (timer.current) window.clearInterval(timer.current);
    setCountdown(0);
  }
  function startCountdown(seconds: number) {
    setCountdown(seconds);
    if (timer.current) window.clearInterval(timer.current);
    if (seconds <= 0) return;
    timer.current = window.setInterval(
      () =>
        setCountdown((value) => {
          if (value <= 1 && timer.current) {
            window.clearInterval(timer.current);
            return 0;
          }
          return value - 1;
        }),
      1000,
    );
  }

  async function sendCode(newRequest = false) {
    if (!isRemote || !tenantCode || operationPending.current || countdown > 0 ||
      !methods.includes("sms") || (isRegister && !canRegister)) return;
    setError("");
    if (!phoneValid(phone)) {
      setError(t("requiredPhone"));
      return;
    }
    operationPending.current = true;
    setPending(true);
    const generation = requestContext.current.generation;
    const current = () => active.current && requestContext.current.generation === generation;
    try {
      let key = readChallengeKey(scope);
      if (newRequest || !key) {
        key = `chal-${crypto.randomUUID()}`;
        const storage = websiteTransientStorage();
        storage.setItem(scope, key);
        if (readChallengeKey(scope) !== key) throw new Error(en
          ? "The original request could not be saved. The code request was stopped."
          : "无法保留原请求引用，未派发验证码请求。");
        registrationRequest.current = null;
        registrationKey.current = null;
        submittedSmsChallenge.current = null;
        setChallengeId(null);
        challengeExpiry.current = null;
        setCode("");
        setDevCode(null);
      }
      setHasChallengeRequest(true);
      const challenge = await authApi.createChallenge({ tenantCode, identifier: phone.trim(),
        purpose: isRegister ? "registration" : "login", idempotencyKey: key });
      if (!current()) return;
      startCountdown(challenge.retryAfterSeconds ?? 0);
      const expiry = Date.parse(challenge.expiresAt);
      const deliveryPending = challenge.deliveryMode === "provider_pending";
      if (typeof challenge.challengeId !== "string" || !challenge.challengeId || challenge.status !== "pending_verification" || !Number.isFinite(expiry) || expiry <= Date.now() || deliveryPending ||
        !["provider", "development"].includes(challenge.deliveryMode ?? "")) {
        setChallengeId(null);
        challengeExpiry.current = null;
        setDevCode(null);
        setError(deliveryPending
          ? en ? "Delivery is awaiting confirmation. Check the original request or choose Get a new code."
            : "原短信投递结果待核对，可核对原请求或选择重新获取。"
          : en ? "The original code is no longer valid for verification. Choose Get a new code."
            : "原验证码已失效或无法验证，请选择重新获取。");
        return;
      }
      setChallengeId(challenge.challengeId);
      challengeExpiry.current = challenge.expiresAt;
      setDevCode(challenge.developmentCode ?? devCode);
    } catch (e: any) {
      if (current()) {
        if (e?.status === 409 || e?.code === "CONFLICT") {
          setChallengeId(null);
          challengeExpiry.current = null;
          setDevCode(null);
        }
        setError(e?.message === "challenge_reference_unavailable"
          ? en ? "The original code request could not be read. Check storage access before continuing."
            : "原验证码请求无法读取，请恢复存储访问后继续。"
          : e?.message || t("loginFailed"));
      }
    } finally {
      operationPending.current = false;
      if (active.current) setPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!isRemote || !tenantCode || operationPending.current || (!isRegister && !canLogin))
      return;
    operationPending.current = true;
    setPending(true);
    const generation = requestContext.current.generation;
    const current = () => active.current && requestContext.current.generation === generation;
    let original = registrationRequest.current;
    if (original?.scope !== scope || original.generation !== generation) original = null;
    let smsDispatched = false;
    try {
      if (!isRegister && loginMode === "sms" && submittedSmsChallenge.current !== null && submittedSmsChallenge.current === challengeId)
        throw new Error(en ? "This code has already been verified. Check your current session, use password sign-in, or explicitly get a new code."
          : "该验证码已验证过，请检查当前登录状态、改用密码登录，或明确重新获取验证码。");
      if (needsCode && !(isRegister && original) && (!challengeId || !challengeExpiry.current || !Number.isFinite(Date.parse(challengeExpiry.current)) || Date.parse(challengeExpiry.current) <= Date.now()))
        throw new Error(en ? "Check the original request or get a new code before continuing."
          : "请先核对原请求或重新获取验证码。");
      if (isRegister) {
        if (!original) {
          if (!canRegister || !userAgreement || !privacyPolicy)
            throw new Error(
              en
                ? "The store must provide current terms before registration."
                : "商户需提供当前生效的协议后才能注册。",
            );
          if (!phoneValid(phone)) throw new Error(t("requiredPhone"));
          if (!name.trim()) throw new Error(t("requiredName"));
          if (password.length < 8) throw new Error(t("loginPasswordRule"));
          if (!agree) throw new Error(t("loginNeedAgree"));
          if (!challengeId) throw new Error(t("loginNeedCode"));
          const input = {
            tenantCode,
            name: name.trim(),
            phone: phone.trim(),
            password,
            consent: {
              userAgreementVersion: userAgreement.version,
              privacyPolicyVersion: privacyPolicy.version,
              agreedAt: new Date().toISOString(),
            },
          };
          const verified = await authApi.verifyChallenge(challengeId, code.trim());
          if (!current()) return;
          registrationKey.current ??= `reg-${crypto.randomUUID()}`;
          original = { scope, generation, input: { ...input, verificationToken: verified.verificationToken, idempotencyKey: registrationKey.current } };
          registrationRequest.current = original;
        }
        const registration = await authApi.register(original.input);
        if (!current()) return;
        if (!registration.customerId) throw new Error(t("loginFailed"));
        if (methods.includes("password")) {
          await authApi.passwordLogin({
            tenantCode,
            loginIdentifier: original.input.phone,
            password: original.input.password,
          }, current);
        } else {
          switchView("login");
          toast.success(
            en
              ? "Account created. Sign in with a new login code."
              : "账户已创建，请获取登录验证码继续。",
          );
        }
      } else if (loginMode === "password") {
        if (!phoneValid(phone)) throw new Error(t("requiredPhone"));
        await authApi.passwordLogin({
          tenantCode,
          loginIdentifier: phone.trim(),
          password,
        }, current);
      } else {
        if (!phoneValid(phone)) throw new Error(t("requiredPhone"));
        if (!challengeId) throw new Error(t("loginNeedCode"));
        const verified = await authApi.verifyChallenge(
          challengeId,
          code.trim(),
        );
        // 登录证明只能消费一次，现有服务端不提供按证明回放登录结果。
        submittedSmsChallenge.current = challengeId;
        if (!current()) return;
        smsDispatched = true;
        await authApi.smsLogin({
          tenantCode,
          loginIdentifier: phone.trim(),
          verificationToken: verified.verificationToken,
        }, current);
      }
    } catch (e: any) {
      if (current()) setError(smsDispatched && !(e?.status >= 400 && e?.status < 500)
        ? en ? "The SMS sign-in result is unconfirmed. Check your current session or use password sign-in; do not verify the same code again."
          : "本次短信登录结果未确认，请检查当前登录状态或改用密码登录，不要重复验证原验证码。"
        : e?.message || t("loginFailed"));
    } finally {
      operationPending.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <div className="shell auth-page">
      <div className="auth-layout">
        <div className="auth-form-side">
          <PageHeading
            title={isRegister ? t("loginRegister") : t("loginCta")}
            description={
              isRegister ? t("registerSubtitle") : t("loginSubtitle")
            }
          />
          {!isRemote && (
            <p className="preview-notice">
              {en
                ? "Layout preview · Sign-in and SMS are disabled in demo mode."
                : "布局预览 · 演示模式不发送短信，也不执行登录。"}
            </p>
          )}
          <div className="login-card">
            {!isRegister && (
              <div
                className="login-tabs"
                role="group"
                aria-label={t("loginTitle")}
              >
                <button
                  type="button"
                  disabled={pending || !methods.includes("sms")}
                  aria-pressed={loginMode === "sms"}
                  className={loginMode === "sms" ? "active" : ""}
                  onClick={() => {
                    setLoginMode("sms");
                    setError("");
                  }}
                >
                  {t("loginSms")}
                </button>
                <button
                  type="button"
                  disabled={pending || !methods.includes("password")}
                  aria-pressed={loginMode === "password"}
                  className={loginMode === "password" ? "active" : ""}
                  onClick={() => {
                    setLoginMode("password");
                    setError("");
                  }}
                >
                  {t("loginPassword")}
                </button>
              </div>
            )}
            <form className="login-form" onSubmit={submit} aria-busy={pending}>
              {isRegister && (
                <label>
                  {t("contactName")}
                  <input
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("namePlaceholder")}
                    maxLength={120}
                  />
                </label>
              )}
              <label>
                {t("loginPhone")}
                <input
                  type="tel"
                  required
                  disabled={pending}
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setChallengeId(null);
                    setCode("");
                    setDevCode(null);
                    setError("");
                  }}
                  placeholder={t("phonePlaceholder")}
                  maxLength={11}
                />
              </label>
              {(isRegister || loginMode === "password") && (
                <label>
                  {t("loginPasswordField")}
                  <span className="password-field">
                    <input
                      required
                      type={passwordVisible ? "text" : "password"}
                      minLength={isRegister ? 8 : undefined}
                      autoComplete={
                        isRegister ? "new-password" : "current-password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        isRegister
                          ? t("loginPasswordRule")
                          : t("loginPasswordPlaceholder")
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={
                        passwordVisible
                          ? en
                            ? "Hide password"
                            : "隐藏密码"
                          : en
                            ? "Show password"
                            : "显示密码"
                      }
                      aria-pressed={passwordVisible}
                      onClick={() => setPasswordVisible(!passwordVisible)}
                    >
                      {passwordVisible ? <EyeOff /> : <Eye />}
                    </button>
                  </span>
                </label>
              )}
              {needsCode && (
                <label>
                  {t("loginCode")}
                  <span className="login-code-row">
                    <input
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder={t("loginCodePlaceholder")}
                      maxLength={6}
                    />
                    <button
                      type="button"
                      className="button button-outline"
                      disabled={
                        !isRemote ||
                        pending ||
                        countdown > 0 ||
                        !phoneValid(phone) ||
                        (isRegister && !canRegister)
                      }
                      onClick={() => void sendCode(Boolean(challengeId))}
                    >
                      {countdown > 0 ? countdown + "s" : hasChallengeRequest && !challengeId && !pending
                        ? en ? "Check original request" : "核对原请求"
                        : t("loginSendCode")}
                    </button>
                  </span>
                  {hasChallengeRequest && !challengeId && !pending && (
                    <button
                      type="button"
                      className="login-switch-link"
                      disabled={!isRemote || pending || countdown > 0 || !phoneValid(phone) || !methods.includes("sms") || (isRegister && !canRegister)}
                      onClick={() => void sendCode(true)}
                    >
                      {en ? "Get a new code" : "重新获取验证码"}
                    </button>
                  )}
                </label>
              )}
              {devCode && (
                <p className="login-dev-code">
                  {t("loginDevCode", { code: devCode })}
                </p>
              )}
              {isRegister && (
                <label className="login-agree">
                  <input
                    required
                    type="checkbox"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                  />
                  <span>
                    {t("loginAgreePrefix")}{" "}
                    <Link
                      to={href("/agreement")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("docUserAgreement")}
                    </Link>{" "}
                    {t("and")}{" "}
                    <Link
                      to={href("/privacy")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("docPrivacyPolicy")}
                    </Link>
                  </span>
                </label>
              )}
              {isRegister && isRemote && !canRegister && (
                <p className="field-note" role="status">
                  {en
                    ? "Registration is currently unavailable. Contact the store for account access."
                    : "当前注册暂不可用，请联系门店了解账户开通方式。"}
                </p>
              )}
              {!isRegister && !canLogin && isRemote && (
                <p className="field-note" role="status">
                  {en
                    ? "Web sign-in is currently unavailable. Contact the store for help."
                    : "当前网页登录暂不可用，请联系门店。"}
                </p>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="button button-dark button-block"
                disabled={
                  !isRemote ||
                  pending ||
                  (!isRegister && !canLogin) ||
                  (isRegister && (!canRegister || !agree))
                }
              >
                {pending && <Loader />}
                {isRegister
                  ? t(
                      methods.includes("password")
                        ? "loginRegisterSubmit"
                        : "loginRegister",
                    )
                  : t("loginSubmit")}
              </button>
            </form>
            <p className="login-switch">
              {isRegister ? t("haveAccount") : t("noAccount")}{" "}
              <button
                type="button"
                disabled={pending}
                className="login-switch-link"
                onClick={() => switchView(isRegister ? "login" : "register")}
              >
                {isRegister ? t("loginCta") : t("loginRegister")}
              </button>
            </p>
            <p className="login-foot">
              {en ? "Before continuing, read our " : "继续前，请阅读"}
              <Link to={href("/agreement")}>{t("docUserAgreement")}</Link>{" "}
              {t("and")}{" "}
              <Link to={href("/privacy")}>{t("docPrivacyPolicy")}</Link>
              {en ? "." : "。"}
            </p>
          </div>
          <Link className="auth-back" to={href("/products")}>
            {t("continueExplore")}
          </Link>
        </div>
        <aside className="auth-story">
          <Img src={tenant.heroImage} alt="" />
          <div>
            <h2>{tenant.name}</h2>
            <p>{tenant.slogan}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

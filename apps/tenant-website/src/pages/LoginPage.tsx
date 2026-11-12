import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader } from "../components/SiteIcon";
import { PageHeading } from "../components/PageHeader";
import { Img } from "../components/Img";
import { useSite } from "../SiteContext";
import { useAuth } from "../AuthContext";
import { authApi } from "../data/authClient";
import { clientApi } from "../data/apiClient";
import {
  parseEnterpriseRoute,
  safeCustomerReturn,
} from "@rental-os/web-client";

// 登录与注册是两件事、两个入口：登录页只留「验证码 / 密码」两种登录方式，
// 注册是登录卡下方「还没有账号？去注册」切到的独立视图（含「已有账号？去登录」返回）。
type View = "login" | "register";
type LoginMode = "sms" | "password";

function phoneValid(phone: string) {
  return /^1\d{10}$/.test(phone.trim());
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
  } = useSite();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
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

  const [view, setView] = useState<View>(
    params.get("view") === "register" ? "register" : "login",
  );
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
  const timer = useRef<number | null>(null);
  const [agreements, setAgreements] = useState<{
    tenantCode: string;
    user: string;
    privacy: string;
  } | null>(null);
  const [agreementsError, setAgreementsError] = useState(false);
  const registrationKey = useRef<string | null>(null);
  const currentTenant = useRef(tenantCode);
  currentTenant.current = tenantCode;

  useEffect(() => {
    if (isAuthenticated) returnToTarget();
  }, [isAuthenticated]);
  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    [],
  );

  const isRegister = view === "register";
  const needsCode = isRegister || loginMode === "sms";
  const canRegister =
    agreements?.tenantCode === tenantCode &&
    Boolean(agreements.user && agreements.privacy);
  useEffect(() => {
    let cancelled = false;
    setAgreements(null);
    setAgreementsError(false);
    if (!isRegister || !isRemote || !tenantCode) return;
    clientApi
      .bootstrap(tenantCode)
      .then((bootstrap) => {
        if (cancelled) return;
        const user = bootstrap.agreements?.userAgreement?.version;
        const privacy = bootstrap.agreements?.privacyPolicy?.version;
        if (!user || !privacy) {
          setAgreementsError(true);
          return;
        }
        setAgreements({ tenantCode, user, privacy });
      })
      .catch(() => {
        if (!cancelled) setAgreementsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isRegister, isRemote, tenantCode]);
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
  function switchView(next: View) {
    setView(next);
    setError("");
    setCode("");
    setChallengeId(null);
    setDevCode(null);
    if (timer.current) window.clearInterval(timer.current);
    setCountdown(0);
  }
  function startCountdown() {
    setCountdown(60);
    if (timer.current) window.clearInterval(timer.current);
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

  async function sendCode() {
    setError("");
    if (!isRemote || !tenantCode || pending || (isRegister && !canRegister))
      return;
    if (!phoneValid(phone)) {
      setError(t("requiredPhone"));
      return;
    }
    setPending(true);
    try {
      const challenge = await authApi.createChallenge({
        tenantCode,
        identifier: phone.trim(),
        purpose: isRegister ? "registration" : "login",
        idempotencyKey: `chal-${Date.now()}`,
      });
      if (currentTenant.current !== tenantCode) return;
      setChallengeId(challenge.challengeId);
      setDevCode(challenge.developmentCode ?? null);
      startCountdown();
    } catch (e: any) {
      setError(e?.message || t("loginFailed"));
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!isRemote || !tenantCode || pending) return;
    setPending(true);
    try {
      if (isRegister) {
        if (!canRegister || !agreements)
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
        const verified = await authApi.verifyChallenge(
          challengeId,
          code.trim(),
        );
        if (currentTenant.current !== tenantCode) return;
        registrationKey.current ??= `reg-${crypto.randomUUID()}`;
        await authApi.register({
          tenantCode,
          name: name.trim(),
          phone: phone.trim(),
          password,
          verificationToken: verified.verificationToken,
          idempotencyKey: registrationKey.current,
          consent: {
            userAgreementVersion: agreements.user,
            privacyPolicyVersion: agreements.privacy,
            agreedAt: new Date().toISOString(),
          },
        });
        if (currentTenant.current !== tenantCode) return;
        // 注册成功后用同一手机号密码直接登录。
        await authApi.passwordLogin({
          tenantCode,
          loginIdentifier: phone.trim(),
          password,
        });
      } else if (loginMode === "password") {
        if (!phoneValid(phone)) throw new Error(t("requiredPhone"));
        await authApi.passwordLogin({
          tenantCode,
          loginIdentifier: phone.trim(),
          password,
        });
      } else {
        if (!phoneValid(phone)) throw new Error(t("requiredPhone"));
        if (!challengeId) throw new Error(t("loginNeedCode"));
        const verified = await authApi.verifyChallenge(
          challengeId,
          code.trim(),
        );
        if (currentTenant.current !== tenantCode) return;
        await authApi.smsLogin({
          tenantCode,
          loginIdentifier: phone.trim(),
          verificationToken: verified.verificationToken,
        });
      }
    } catch (e: any) {
      if (currentTenant.current === tenantCode)
        setError(e?.message || t("loginFailed"));
    } finally {
      if (currentTenant.current === tenantCode) setPending(false);
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
                  disabled={pending}
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
                  disabled={pending}
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
                      onClick={sendCode}
                    >
                      {countdown > 0 ? countdown + "s" : t("loginSendCode")}
                    </button>
                  </span>
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
                    <Link to={href("/agreement")}>{t("docUserAgreement")}</Link>{" "}
                    {t("and")}{" "}
                    <Link to={href("/privacy")}>{t("docPrivacyPolicy")}</Link>
                  </span>
                </label>
              )}
              {isRegister && isRemote && !canRegister && (
                <p className="field-note" role="status">
                  {agreementsError
                    ? en
                      ? "Current terms are unavailable. Please contact the store before registering."
                      : "当前协议暂不可用，请联系门店后再注册。"
                    : en
                      ? "Loading the current terms…"
                      : "正在读取当前协议…"}
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
                  (isRegister && (!canRegister || !agree))
                }
              >
                {pending && <Loader />}
                {isRegister ? t("loginRegisterSubmit") : t("loginSubmit")}
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

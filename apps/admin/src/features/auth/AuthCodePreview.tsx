import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { Check } from "lucide-react";
import { Input as ArcInput } from "@/registry/components/input/input";
import { OtpInput } from "@/registry/components/otp-input/otp-input";
import styles from "@/registry/blocks/login-centered/login-centered.module.css";
import { motionTokens } from "@/lib/motion-tokens";
import { Alert, Button, PasswordField, PasswordStrength, PhoneInput, Segmented } from "@/components/ui";
import { ArcLocale } from "@/components/ui/ArcLocale";
import { useLocale } from "@/app/locale";

type Channel = "phone" | "email";
type Stage = "identity" | "code" | "password" | "done";
/** These variants are the public LoginCentered step transition, unchanged. */
const stepMotion: Variants = {
  enter: ({ direction, reduce }) => reduce ? { opacity: 0 } : { opacity: 0, y: direction * 12, filter: `blur(${motionTokens.blur.soft}px)` },
  center: ({ reduce }) => ({ opacity: 1, y: 0, filter: "blur(0px)", transition: reduce ? { duration: motionTokens.duration.instant } : { y: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: motionTokens.ease.enter, delay: .06 }, filter: { duration: motionTokens.duration.standard, ease: motionTokens.ease.enter, delay: .04 } } }),
  exit: ({ direction, reduce }) => reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: direction * -8, filter: `blur(${motionTokens.blur.soft}px)`, transition: { duration: motionTokens.duration.exit, ease: motionTokens.ease.standard } },
};
const PREVIEW_CODE = "123456";

/** UI-only boundary: no API imports, authentication, credential storage or password mutation. */
export function AuthCodePreview({ mode, tenantCode = "", tenantLocked, onTenantChange, onBack }: {
  mode: Channel | "reset"; tenantCode?: string; tenantLocked: boolean;
  onTenantChange: (value: string) => void; onBack: () => void;
}) {
  const { t } = useLocale();
  const reduce = Boolean(useReducedMotion());
  const [channel, setChannel] = useState<Channel>(mode === "email" ? "email" : "phone");
  const [stage, setStage] = useState<Stage>("identity");
  const [direction, setDirection] = useState(1);
  const [address, setAddress] = useState("");
  const [phoneValid, setPhoneValid] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const reset = mode === "reset";
  const clearVerification = () => { setStage("identity"); setCode(""); setPassword(""); setConfirmation(""); setError(""); setResendIn(0); };
  useEffect(() => { clearVerification(); }, [tenantCode]);
  useEffect(() => {
    if (stage !== "code" || resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [stage, resendIn]);
  const go = (next: Stage, backwards = false) => { setDirection(backwards ? -1 : 1); setError(""); setStage(next); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (stage === "identity") {
      if (!/^[a-z][a-z0-9_-]{1,31}$/i.test(tenantCode.trim())) { setError(t("请输入有效的租户编码")); return; }
      const valid = channel === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()) : phoneValid && Boolean(address.trim());
      if (!valid) { setError(t(channel === "phone" ? "请输入有效的手机号" : "请输入有效的邮箱")); return; }
      setCode(""); setResendIn(30); go("code");
    } else if (stage === "code") {
      if (code !== PREVIEW_CODE) { setError(t("预览验证码不正确，请输入 123456")); return; }
      setCode(""); go(reset ? "password" : "done");
    } else if (stage === "password") {
      if (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password) || !/[^a-z0-9]/i.test(password)) { setError(t("密码至少 8 位，包含字母、数字和特殊字符")); return; }
      if (password !== confirmation) { setError(t("两次输入的密码不一致")); return; }
      setPassword(""); setConfirmation(""); go("done");
    }
  };
  const custom = { direction, reduce };
  return <section className="login-code-preview" aria-label={t(reset ? "找回密码预览" : "验证码登录预览")}>
    <Alert type="info" title={t("仅前端预览，暂未接入验证码服务")} description={t("不会发送短信或邮件，不会登录账号，也不会修改真实密码。")} />
    {reset && stage === "identity" && <Segmented value={channel} onChange={value => { setChannel(value as Channel); setAddress(""); setPhoneValid(false); clearVerification(); }} options={[{ value: "phone", label: t("手机验证") }, { value: "email", label: t("邮箱验证") }]} />}
    <div className="login-preview-viewport"><AnimatePresence initial={false} mode="wait" custom={custom}>
      <motion.div key={stage} custom={custom} variants={stepMotion} initial="enter" animate="center" exit="exit" onAnimationComplete={() => {
        const preview = document.querySelector(".login-code-preview");
        if (stage === "done") preview?.querySelector<HTMLElement>(".login-preview-result")?.focus();
        else preview?.querySelector<HTMLInputElement>("input:not([disabled]):not([type='hidden'])")?.focus();
      }}>
        {stage === "done" ? <div className="login-preview-result" role="status" tabIndex={-1}>
          <Check className={styles.success} aria-hidden="true" />
          <h3>{t(reset ? "密码修改效果预览完成" : "验证码登录效果预览完成")}</h3>
          <p>{t(reset ? "真实密码未修改，请使用原密码登录。" : "未建立登录会话，请使用账号密码登录。")}</p>
          <Button block type="primary" onClick={onBack}>{t("返回账号密码登录")}</Button>
        </div> : <form className={styles.form} onSubmit={submit} noValidate>
          {stage === "identity" && <>
            {!tenantLocked && <ArcInput label={t("租户编码")} value={tenantCode} onChange={event => onTenantChange(event.target.value)} autoComplete="organization" />}
            {channel === "phone" ? <PhoneInput label={t("手机号")} value={address} onValueChange={(value, details) => { setAddress(value); setPhoneValid(details.valid); setError(""); }} error={error} /> : <ArcInput label={t("邮箱")} type="email" value={address} onChange={event => { setAddress(event.target.value); setError(""); }} autoComplete="email" placeholder="name@example.com" maxLength={254} />}
          </>}
          {stage === "code" && <>
            <p className="login-preview-target">{t("验证目标")}: {address.trim()}</p>
            <ArcLocale><OtpInput label={t("六位验证码")} value={code} onChange={value => { setCode(value); setError(""); }} error={error} description={t("本次仅预览：请输入 123456，未发送真实验证码。")}/></ArcLocale>
            <div className="login-preview-links">
              <Button type="text" size="small" onClick={() => { setCode(""); setResendIn(0); go("identity", true); }}>{t("修改手机号或邮箱")}</Button>
              <Button type="text" size="small" disabled={resendIn > 0} onClick={() => { setCode(""); setError(""); setResendIn(30); }}>{resendIn > 0 ? `${resendIn}s ${t("后可重新获取")}` : t("重新获取（预览）")}</Button>
            </div>
          </>}
          {stage === "password" && <>
            <input type="hidden" name="username" autoComplete="username" value={address.trim()} readOnly />
            <PasswordStrength label={t("新密码")} value={password} onValueChange={setPassword} autoComplete="new-password" maxLength={128} />
            <PasswordField label={t("确认新密码")} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" maxLength={128} />
            <p className="text-meta">{t("密码至少 8 位，包含字母、数字和特殊字符")}</p>
          </>}
          {error && stage !== "code" && <Alert type="error" title={error} />}
          <Button type="primary" htmlType="submit" block>{t(stage === "identity" ? "获取验证码（预览）" : stage === "code" ? "验证并继续（预览）" : "确认修改（预览）")}</Button>
        </form>}
      </motion.div>
    </AnimatePresence></div>
    {stage !== "done" && <Button type="text" onClick={onBack}>{t("返回账号密码登录")}</Button>}
  </section>;
}

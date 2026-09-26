import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircleOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { authApi, type ClientSession } from '../data/authClient';
import { clientApi } from '../data/apiClient';

// 登录与注册是两件事、两个入口：登录页只留「验证码 / 密码」两种登录方式，
// 注册是登录卡下方「还没有账号？去注册」切到的独立视图（含「已有账号？去登录」返回）。
type View = 'login' | 'register';
type LoginMode = 'sms' | 'password';

function phoneValid(phone: string) {
  return /^1\d{10}$/.test(phone.trim());
}

export function LoginPage() {
  const { tenantCode, isRemote, href, t } = useSite();
  const { setSession, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/orders';

  const [view, setView] = useState<View>('login');
  const [loginMode, setLoginMode] = useState<LoginMode>('sms');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => { if (isAuthenticated) navigate(href(redirect), { replace: true }); }, [isAuthenticated]);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const isRegister = view === 'register';
  const needsCode = isRegister || loginMode === 'sms';
  function switchView(next: View) { setView(next); setError(''); setCode(''); setChallengeId(null); setDevCode(null); if (timer.current) window.clearInterval(timer.current); setCountdown(0); }
  function startCountdown() {
    setCountdown(60);
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => setCountdown(value => {
      if (value <= 1 && timer.current) { window.clearInterval(timer.current); return 0; }
      return value - 1;
    }), 1000);
  }

  function land(session: ClientSession) {
    setSession(session);
    navigate(href(redirect), { replace: true });
  }

  async function sendCode() {
    setError('');
    if (!tenantCode) return;
    if (!phoneValid(phone)) { setError(t('requiredPhone')); return; }
    setPending(true);
    try {
      const challenge = await authApi.createChallenge({ tenantCode, identifier: phone.trim(), purpose: isRegister ? 'registration' : 'login', idempotencyKey: `chal-${Date.now()}` });
      setChallengeId(challenge.challengeId);
      setDevCode(challenge.developmentCode ?? null);
      startCountdown();
    } catch (e: any) {
      setError(e?.message || t('loginFailed'));
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!tenantCode) return;
    setPending(true);
    try {
      if (isRegister) {
        if (!name.trim()) throw new Error(t('requiredName'));
        if (password.length < 8) throw new Error(t('loginPasswordRule'));
        if (!agree) throw new Error(t('loginNeedAgree'));
        if (!challengeId) throw new Error(t('loginNeedCode'));
        const verified = await authApi.verifyChallenge(challengeId, code.trim());
        const boot = await clientApi.bootstrap(tenantCode).catch(() => null);
        await authApi.register({
          tenantCode, name: name.trim(), phone: phone.trim(), password, verificationToken: verified.verificationToken,
          idempotencyKey: `reg-${Date.now()}`,
          consent: {
            userAgreementVersion: boot?.agreements?.userAgreement?.version || '1',
            privacyPolicyVersion: boot?.agreements?.privacyPolicy?.version || '1',
            agreedAt: new Date().toISOString(),
          },
        });
        // 注册成功后用同一手机号密码直接登录。
        land(await authApi.passwordLogin({ tenantCode, loginIdentifier: phone.trim(), password }));
      } else if (loginMode === 'password') {
        if (!phoneValid(phone)) throw new Error(t('requiredPhone'));
        land(await authApi.passwordLogin({ tenantCode, loginIdentifier: phone.trim(), password }));
      } else {
        if (!challengeId) throw new Error(t('loginNeedCode'));
        const verified = await authApi.verifyChallenge(challengeId, code.trim());
        land(await authApi.smsLogin({ tenantCode, loginIdentifier: phone.trim(), verificationToken: verified.verificationToken }));
      }
    } catch (e: any) {
      setError(e?.message || t('loginFailed'));
    } finally {
      setPending(false);
    }
  }
  if (!isRemote) {
    return <div className="shell simple-page"><div className="page-intro"><h1>{t('loginTitle')}</h1><p>{t('loginDemoNotice')}</p></div><Link className="button button-dark" to={href('/')}>{t('backHome')}</Link></div>;
  }

  return <div className="shell simple-page login-page">
    <div className="page-intro"><h1>{isRegister ? t('loginRegister') : t('loginCta')}</h1><p>{isRegister ? t('registerSubtitle') : t('loginSubtitle')}</p></div>
    <div className="login-card">
      {!isRegister && <div className="login-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={loginMode === 'sms'} className={loginMode === 'sms' ? 'active' : ''} onClick={() => { setLoginMode('sms'); setError(''); }}>{t('loginSms')}</button>
        <button type="button" role="tab" aria-selected={loginMode === 'password'} className={loginMode === 'password' ? 'active' : ''} onClick={() => { setLoginMode('password'); setError(''); }}>{t('loginPassword')}</button>
      </div>}
      <form className="login-form" onSubmit={submit}>
        {isRegister && <label>{t('contactName')}<input value={name} onChange={e => setName(e.target.value)} placeholder={t('namePlaceholder')} maxLength={120} /></label>}
        <label>{t('loginPhone')}<input inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('phonePlaceholder')} maxLength={11} /></label>
        {(!isRegister && loginMode === 'password') && <label>{t('loginPasswordField')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('loginPasswordPlaceholder')} /></label>}
        {isRegister && <label>{t('loginPasswordField')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('loginPasswordRule')} /></label>}
        {needsCode && <label>{t('loginCode')}
          <span className="login-code-row">
            <input inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} placeholder={t('loginCodePlaceholder')} maxLength={6} />
            <button type="button" className="button button-outline" disabled={pending || countdown > 0 || !phoneValid(phone)} onClick={sendCode}>{countdown > 0 ? `${countdown}s` : t('loginSendCode')}</button>
          </span>
        </label>}
        {devCode && <p className="login-dev-code"><CheckCircleOutlined /> {t('loginDevCode', { code: devCode })}</p>}
        {isRegister && <label className="login-agree"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>{t('loginAgreePrefix')} <Link to={href('/agreement')}>{t('docUserAgreement')}</Link> {t('and')} <Link to={href('/privacy')}>{t('docPrivacyPolicy')}</Link></span></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="button button-dark button-block" disabled={pending}>{isRegister ? t('loginRegisterSubmit') : t('loginSubmit')}</button>
      </form>
      <p className="login-switch">{isRegister ? t('haveAccount') : t('noAccount')} <button type="button" className="login-switch-link" onClick={() => switchView(isRegister ? 'login' : 'register')}>{isRegister ? t('loginCta') : t('loginRegister')}</button></p>
      <p className="login-foot">{t('loginFootNote')}</p>
    </div>
  </div>;
}


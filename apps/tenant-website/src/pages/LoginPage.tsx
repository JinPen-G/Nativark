import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRightOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { authApi, type ClientSession } from '../data/authClient';
import { clientApi } from '../data/apiClient';

type Mode = 'sms' | 'password' | 'register';

function phoneValid(phone: string) {
  return /^1\d{10}$/.test(phone.trim());
}

export function LoginPage() {
  const { tenantCode, isRemote, href, t } = useSite();
  const { setSession, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/orders';

  const [mode, setMode] = useState<Mode>('sms');
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

  useEffect(() => {
    if (isAuthenticated) navigate(href(redirect), { replace: true });
  }, [isAuthenticated]);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

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
      const purpose = mode === 'register' ? 'register' : 'login';
      const challenge = await authApi.createChallenge({ tenantCode, identifier: phone.trim(), purpose: purpose === 'register' ? 'registration' : 'login', idempotencyKey: `chal-${Date.now()}` });
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
      if (mode === 'password') {
        if (!phoneValid(phone)) throw new Error(t('requiredPhone'));
        land(await authApi.passwordLogin({ tenantCode, loginIdentifier: phone.trim(), password }));
      } else if (mode === 'sms') {
        if (!challengeId) throw new Error(t('loginNeedCode'));
        const verified = await authApi.verifyChallenge(challengeId, code.trim());
        land(await authApi.smsLogin({ tenantCode, loginIdentifier: phone.trim(), verificationToken: verified.verificationToken }));
      } else {
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
      }
    } catch (e: any) {
      setError(e?.message || t('loginFailed'));
    } finally {
      setPending(false);
    }
  }

  if (!isRemote) {
    return <div className="shell simple-page"><div className="page-intro"><span className="eyebrow">ACCOUNT</span><h1>{t('loginTitle')}</h1><p>{t('loginDemoNotice')}</p></div><Link className="button button-dark" to={href('/')}>{t('backHome')} <ArrowRightOutlined /></Link></div>;
  }

  const tabs: Array<{ id: Mode; label: string }> = [
    { id: 'sms', label: t('loginSms') },
    { id: 'password', label: t('loginPassword') },
    { id: 'register', label: t('loginRegister') },
  ];
  const needsCode = mode === 'sms' || mode === 'register';

  return <div className="shell simple-page login-page">
    <div className="page-intro"><span className="eyebrow">ACCOUNT</span><h1>{t('loginTitle')}</h1><p>{t('loginSubtitle')}</p></div>
    <div className="login-card">
      <div className="login-tabs" role="tablist">
        {tabs.map(tab => <button key={tab.id} role="tab" aria-selected={mode === tab.id} className={mode === tab.id ? 'active' : ''} onClick={() => { setMode(tab.id); setError(''); }}>{tab.label}</button>)}
      </div>
      <form className="login-form" onSubmit={submit}>
        {mode === 'register' && <label>{t('contactName')}<input value={name} onChange={e => setName(e.target.value)} placeholder={t('namePlaceholder')} maxLength={120} /></label>}
        <label>{t('loginPhone')}<input inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('phonePlaceholder')} maxLength={11} /></label>
        {mode === 'password'
          ? <label>{t('loginPasswordField')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('loginPasswordPlaceholder')} /></label>
          : null}
        {mode === 'register' && <label>{t('loginPasswordField')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('loginPasswordRule')} /></label>}
        {needsCode && <label>{t('loginCode')}
          <span className="login-code-row">
            <input inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} placeholder={t('loginCodePlaceholder')} maxLength={6} />
            <button type="button" className="button button-outline" disabled={pending || countdown > 0 || !phoneValid(phone)} onClick={sendCode}>{countdown > 0 ? `${countdown}s` : t('loginSendCode')}</button>
          </span>
        </label>}
        {devCode && <p className="login-dev-code"><CheckCircleOutlined /> {t('loginDevCode', { code: devCode })}</p>}
        {mode === 'register' && <label className="login-agree"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>{t('loginAgree')}</span></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="button button-dark button-block" disabled={pending}>{mode === 'register' ? t('loginRegisterSubmit') : t('loginSubmit')} <ArrowRightOutlined /></button>
      </form>
      <p className="login-foot">{t('loginFootNote')}</p>
    </div>
  </div>;
}

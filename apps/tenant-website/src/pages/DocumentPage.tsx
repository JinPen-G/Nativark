import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightOutlined, LoadingOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { clientApi, type PublicDocumentResponse } from '../data/apiClient';

type Kind = 'user_agreement' | 'privacy_policy' | 'help';

const TITLE_KEY: Record<Kind, string> = { user_agreement: 'docUserAgreement', privacy_policy: 'docPrivacyPolicy', help: 'helpTitle' };

/** 用户协议 / 隐私政策 / 帮助：真实租户读后台配置的正文；演示或未配置时回落通用文案。 */
export function DocumentPage({ kind }: { kind: Kind }) {
  const { tenantCode, isRemote, href, t } = useSite();
  const [doc, setDoc] = useState<PublicDocumentResponse | null>(null);
  const [loading, setLoading] = useState(isRemote);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isRemote || !tenantCode) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setMissing(false); setDoc(null);
    clientApi.publicDocument(tenantCode, kind)
      .then(d => { if (!cancelled) setDoc(d); })
      .catch(() => { if (!cancelled) setMissing(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantCode, isRemote, kind]);

  const title = doc?.name || t(TITLE_KEY[kind] as any);

  // 帮助页：真实租户无配置时回落到通用 FAQ；协议/隐私无配置时提示商户未提供。
  const fallbackHelp = kind === 'help';

  return <div className="shell simple-page doc-page">
    <div className="page-intro"><h1>{title}</h1>{doc?.version ? <p>{t('docVersion', { version: doc.version })}</p> : null}</div>
    {loading ? <p className="mock-note"><LoadingOutlined /> {t('loading')}</p> : null}
    {!loading && doc ? <div className="doc-body">
      {doc.intro ? <p className="doc-intro">{doc.intro}</p> : null}
      {doc.body ? <div className="doc-text">{doc.body.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div> : null}
      {doc.url ? <p><a href={doc.url} target="_blank" rel="noreferrer">{t('docExternalLink')} <ArrowRightOutlined /></a></p> : null}
      {doc.faq?.length ? <div className="faq-list">{doc.faq.map((item, i) => <details key={i}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div> : null}
      {!doc.body && !doc.url && !doc.intro && !doc.faq?.length ? <p className="mock-note">{t('docNotProvided')}</p> : null}
    </div> : null}
    {!loading && !doc && fallbackHelp ? <div className="faq-list">
      <details><summary>{t('faqTerm')}</summary><p>{t('faqTermText')}</p></details>
      <details><summary>{t('faqDeposit')}</summary><p>{t('faqDepositText')}</p></details>
      <details><summary>{t('faqDelivery')}</summary><p>{t('faqDeliveryText')}</p></details>
    </div> : null}
    {!loading && !doc && !fallbackHelp ? <p className="mock-note">{isRemote && missing ? t('docNotProvided') : t('docDemoNotice')}</p> : null}
    <Link className="button button-dark" to={href('/')} style={{ marginTop: 24 }}>{t('backHome')}</Link>
  </div>;
}

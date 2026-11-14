import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Document, ExternalLink, Guide, Headphones, Search, ShieldCheck } from '../components/SiteIcon';
import { LoadingState, PageState } from '../components/PageState';
import { useSite } from '../SiteContext';
import { clientApi, type PublicDocumentResponse } from '../data/apiClient';
import { createElement, type ReactNode } from 'react';
import { PageHeading } from '../components/PageHeader';
import { parseClientRichText, type ClientRichTextNode } from '@rental-os/shared';
import { ClientPublicBrowse } from '../features/ai-native/ClientPublicBrowse';

function DocumentBody({ body }: { body: string }) {
  const nodes = parseClientRichText(body);
  const render = (items: ClientRichTextNode[]): ReactNode[] => items.map((node, index) => node.type === 'text' ? node.text : createElement(node.name, { key: index, ...(node.name === 'a' ? { href: node.attrs?.href, rel: 'noreferrer' } : {}) }, ...(['br', 'hr'].includes(node.name) ? [] : render(node.children))));
  return <div className="doc-text">{nodes ? render(nodes) : body.split('\n').map((line, index) => <p key={index}>{line}</p>)}</div>;
}

type Kind = 'user_agreement' | 'privacy_policy' | 'help';

const TITLE_KEY: Record<Kind, string> = { user_agreement: 'docUserAgreement', privacy_policy: 'docPrivacyPolicy', help: 'helpTitle' };

/** 用户协议 / 隐私政策 / 帮助：真实租户读后台配置的正文；演示或未配置时回落通用文案。 */
export function DocumentPage({ kind }: { kind: Kind }) {
  const { tenantCode, isRemote, href, t, tenant, language } = useSite();
  const [doc, setDoc] = useState<PublicDocumentResponse | null>(null);
  const [loading, setLoading] = useState(isRemote);
  const [missing, setMissing] = useState(false);
  const [search, setSearch] = useState('');
  const en = language === 'en';

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

  const defaultFaq = [
    { question: t('faqTerm'), answer: t('faqTermText') },
    { question: t('faqDeposit'), answer: t('faqDepositText') },
    { question: t('faqDelivery'), answer: t('faqDeliveryText') },
  ];
  const faq = doc?.faq?.length ? doc.faq : !doc && fallbackHelp ? defaultFaq : [];
  const visibleFaq = faq.filter(item => (item.question + ' ' + item.answer).toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
  return <div className="shell simple-page doc-page">
    <PageHeading title={title} description={doc?.version ? t('docVersion', { version: doc.version }) : kind === 'help' ? t('helpDescription') : undefined} />
    <div className="doc-layout">
      <nav className="doc-navigation" aria-label={t('footerLegal')}>
        <Link to={href('/help')} aria-current={kind === 'help' ? 'page' : undefined}><Headphones />{t('footerHelp')}</Link>
        <Link to={href('/guide')}><Guide />{t('guide')}</Link>
        <Link to={href('/agreement')} aria-current={kind === 'user_agreement' ? 'page' : undefined}><Document />{t('docUserAgreement')}</Link>
        <Link to={href('/privacy')} aria-current={kind === 'privacy_policy' ? 'page' : undefined}><ShieldCheck />{t('docPrivacyPolicy')}</Link>
      </nav>
      <div className="doc-reading">
        {kind === 'help' && isRemote && tenantCode && tenant.categories[0] && <ClientPublicBrowse tenantCode={tenantCode}
          serviceCode={tenant.categories[0].id} kind="help" english={en} loginHref={href('/login?redirect=%2Fhelp')} />}
        {loading ? <LoadingState label={t('loading')} /> : <>
          {doc && <div className="doc-body">{doc.intro && <p className="doc-intro">{doc.intro}</p>}{doc.body && <DocumentBody body={doc.body} />}{doc.url && <p><a className="external-document-link" href={doc.url} target="_blank" rel="noreferrer">{t('docExternalLink')}<ExternalLink /></a></p>}{!doc.body && !doc.url && !doc.intro && !doc.faq?.length && <PageState icon={<Document />} title={t('docNotProvided')} />}</div>}
          {faq.length > 0 && <><label className="help-search"><Search /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={en ? 'Search rental questions' : '搜索租赁问题'} aria-label={en ? 'Search rental questions' : '搜索租赁问题'} /></label>
            <p className="help-result-count" role="status">{visibleFaq.length} {en ? 'question(s)' : '个问题'}</p>
            {visibleFaq.length ? <div className="faq-list">{visibleFaq.map(item => <details key={item.question}><summary><span>{item.question}</span><ChevronDown /></summary><p>{item.answer}</p></details>)}</div> : <PageState title={en ? 'No matching questions' : '未找到相关问题'}><button type="button" className="button button-outline" onClick={() => setSearch('')}>{en ? 'Clear search' : '清空搜索'}</button></PageState>}
          </>}
          {!doc && !fallbackHelp && <PageState icon={kind === 'privacy_policy' ? <ShieldCheck /> : <Document />} title={en ? 'Document not available yet' : '暂未提供文件正文'} description={isRemote && missing ? t('docNotProvided') : t('docDemoNotice')} />}
          {fallbackHelp && <section className="help-contact"><Headphones /><div><h2>{en ? 'Need a little more help?' : '还有其他问题？'}</h2><p>{tenant.customerService}</p>{isRemote && tenant.phone ? <a href={'tel:' + tenant.phone}>{tenant.phone}</a> : <p className="field-note">{en ? 'Demo preview · Contact details are not connected.' : '演示预览 · 尚未连接真实门店客服。'}</p>}</div><Link className="button button-outline" to={href('/guide')}>{t('guide')}</Link></section>}
        </>}
      </div>
    </div>
  </div>;
}

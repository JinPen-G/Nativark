import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { Copy, ExternalLink } from 'lucide-react';
import { safeLink, type ChatSource } from './chat-state';
import { BrandMark } from '../shared/BrandMark';

type Ast = { type: string; value?: string; url?: string; children?: Ast[] };
export function SourceLink({ source, index, row = false }: { source: ChatSource; index?: number; row?: boolean }) {
  const url = safeLink(source.url);
  if (!url) return <span>{index ?? source.title}</span>;
  return <span className={`chat-source-wrap ${row ? 'is-source-row' : ''}`}><a className={index ? 'chat-citation' : row ? 'chat-source-row' : 'chat-source-link'} href={url} target="_blank" rel="noreferrer" aria-label={`Source ${index ?? ''}: ${source.title}, ${new URL(url).hostname}`}>
    {index ?? (row ? <><BrandMark brand={source.brand ?? 'web'} size={15} /><span className="chat-source-title">{source.title}</span><span className="chat-source-domain">{new URL(url).hostname.replace(/^www\./, '')}</span></> : <><ExternalLink size={12} />{source.title}</>)}
  </a><span className="chat-source-preview" role="tooltip"><strong>{source.title}</strong><span>{new URL(url).hostname}</span><span>{source.description}</span></span></span>;
}
function citationPlugin() {
  return (tree: Ast) => {
    const walk = (node: Ast) => {
      if (!node.children || ['link', 'code', 'inlineCode'].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value) { walk(child); return [child]; }
        const parts: Ast[] = []; let offset = 0;
        for (const match of child.value.matchAll(/\[(\d+)\]/g)) {
          if (match.index! > offset) parts.push({ type: 'text', value: child.value.slice(offset, match.index) });
          parts.push({ type: 'link', url: `#cite-${match[1]}`, children: [{ type: 'text', value: match[1] }] });
          offset = match.index! + match[0].length;
        }
        if (offset < child.value.length) parts.push({ type: 'text', value: child.value.slice(offset) });
        return parts.length ? parts : [child];
      });
    };
    walk(tree);
  };
}
function words(children: ReactNode, streaming: boolean) {
  return Children.map(children, (child, childIndex) => typeof child === 'string' && streaming
    ? child.split(/(\s+)/).map((word, index) => <span className="chat-word" key={`${childIndex}-${index}`}>{word}</span>) : child);
}
export function ChatMarkdown({ content, sources = [], streaming = false, onCopy }: { content: string; sources?: ChatSource[]; streaming?: boolean; onCopy: (value: string) => void }) {
  return <div className={`chat-markdown ${streaming ? 'is-streaming' : ''}`}><Markdown remarkPlugins={[citationPlugin]} components={{
    p: ({ children }) => <p>{words(children, streaming)}</p>,
    li: ({ children }) => <li>{words(children, streaming)}</li>,
    a: ({ href, children }) => {
      const index = Number(href?.match(/^#cite-(\d+)$/)?.[1]);
      if (index) return sources[index - 1] ? <SourceLink source={sources[index - 1]} index={index} /> : <Fragment>{children}</Fragment>;
      const url = href ? safeLink(href) : undefined;
      return url ? <a href={url} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
    },
    pre: ({ children }) => <div className="chat-code"><div className="chat-code-bar"><span>{Children.toArray(children).map(child => isValidElement<{ className?: string }>(child) ? child.props.className?.match(/language-([\w+-]+)/)?.[1] : undefined).find(Boolean) ?? 'text'}</span><button type="button" onClick={event => {
      const code = event.currentTarget.closest('.chat-code')?.querySelector('code')?.textContent ?? '';
      onCopy(code);
    }} aria-label="复制内容"><Copy size={12} />复制</button></div><pre>{children}</pre></div>,
  }}>{content}</Markdown></div>;
}

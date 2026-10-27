import { useId, useState } from 'react';
import { AlertCircle, Search } from 'lucide-react';
import { BrandMark } from '../shared/BrandMark';
import { SourceLink } from './ChatMarkdown';
import type { ChatTool } from './chat-state';

export function ToolCall({ tool }: { tool: ChatTool }) {
  const [open, setOpen] = useState(false), id = useId();
  const brands = [...new Set(tool.sources?.map(source => source.brand).filter(Boolean))];
  return <div className={`chat-tool-call ${open ? 'is-open' : ''}`}>
    <button type="button" className={`chat-tool-chip ${tool.status === 'running' ? 'chat-shimmer' : ''}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {tool.kind === 'query' ? <BrandMark brand={tool.brand ?? 'postgresql'} size={14} /> : <Search size={14} strokeWidth={1.75} />}
      <span>{tool.name}</span>{brands.length > 0 && <span className="chat-tool-marks">{brands.map(brand => <BrandMark key={brand} brand={brand} size={13} />)}</span>}{tool.summary && <span className="chat-tool-summary">{tool.summary}</span>}
    </button>
    <div className="chat-tool-fold" inert={!open}><div id={id}>
      <div className="chat-tool-panel">
        {tool.status === 'error' && <p className="chat-tool-failure"><AlertCircle size={14} /> 调用失败</p>}
        {!!tool.queries?.length && <div className="chat-tool-queries">{tool.queries.map(query => <div key={query}><Search size={13} strokeWidth={1.65} /><span>{query}</span></div>)}</div>}
        {tool.input && <pre className="chat-tool-query">{tool.input}</pre>}
        {tool.output && <div className="chat-tool-result"><span>返回结果</span><pre>{tool.output}</pre></div>}
        {!!tool.sources?.length && <div className="chat-tool-sources">{tool.sources.map(source => <SourceLink key={source.id} source={source} row />)}</div>}
        {!tool.sources?.length && !tool.input && !tool.output && <p>{tool.status === 'running' ? '正在检索本地示例…' : tool.summary ?? '已完成'}</p>}
      </div>
    </div></div>
  </div>;
}

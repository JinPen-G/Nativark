/** Static opaque-frame bootstrap. Generated HTML is inert data, validated and
 * rebuilt here; scripts, URLs, remote dependencies and nested frames never run.
 * Bounded DOM work plus a host deadline are not a browser hard-memory sandbox. */
import { AI_WORKBENCH_DISPLAY_DRAFT_VERSION, AI_WORKBENCH_DISPLAY_LIMITS,
  type AiTaskInputAnswerDraft, type AiTaskInputFieldDraft, type AiWorkbenchMountBindingDraft } from '@rental-os/shared';
import type { WorkbenchDisplayMaterial } from './workbench-display-host';

type FrameField = AiTaskInputFieldDraft & { editable: boolean; initial?: string | number };
interface FrameSeed {
  version: string; parentOrigin: string; nonce: string; binding: AiWorkbenchMountBindingDraft;
  source: string; fields: FrameField[]; fieldRevision: number | null;
  sourceIds: readonly string[]; proposals: WorkbenchDisplayMaterial['proposals'];
  limits: typeof AI_WORKBENCH_DISPLAY_LIMITS;
}
export interface WorkbenchFrameTheme { color?: string; background?: string; fontFamily?: string; colorScheme?: string }

export function buildWorkbenchFrameDocument(material: WorkbenchDisplayMaterial, binding: AiWorkbenchMountBindingDraft,
  nonce: string, parentOrigin: string, answers: readonly AiTaskInputAnswerDraft[] = [], theme: WorkbenchFrameTheme = {}): string {
  if (!/^[a-f0-9]{32,64}$/u.test(nonce) || !/^https?:\/\/[^\s<>"']+$/u.test(parentOrigin)) throw Error('AI_RESOURCE_UNAVAILABLE');
  const fields = material.fieldMaterial?.contract?.fields.map(field => {
    const policy = material.fieldMaterial!.fields.find(item => item.fieldId === field.fieldId)!;
    const held = answers.find(answer => answer.fieldId === field.fieldId);
    const provided = policy.defaultValue.status === 'provided' ? policy.defaultValue.value : undefined;
    return { ...field, editable: policy.editable, ...(held || provided !== undefined ? { initial: held?.value ?? provided } : {}) };
  }) ?? [];
  const seed: FrameSeed = { version: AI_WORKBENCH_DISPLAY_DRAFT_VERSION, parentOrigin, nonce, binding,
    source: material.presentation.code.source, fields, fieldRevision: material.fieldMaterial?.fieldRevision ?? null,
    sourceIds: material.sourceIds, proposals: material.proposals, limits: AI_WORKBENCH_DISPLAY_LIMITS };
  // Source stays JSON data. Escaping '<' prevents a generated </script> from
  // breaking the inert seed element; only this static bootstrap has a nonce.
  const json = JSON.stringify(seed).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
  if (new TextEncoder().encode(json).byteLength > 262144) throw Error('AI_RESOURCE_UNAVAILABLE');
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; `
    + "img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; "
    + "worker-src 'none'; form-action 'none'; base-uri 'none'";
  const safeColor = (value: string | undefined, fallback: string) => value && value.length <= 80
    && /^(?:#[a-f0-9]{3,8}|rgba?\([0-9., %]+\)|hsla?\([0-9., %]+\)|Canvas|CanvasText)$/iu.test(value) ? value : fallback;
  const color = safeColor(theme.color, 'CanvasText'), background = safeColor(theme.background, 'Canvas');
  const family = theme.fontFamily && theme.fontFamily.length <= 180 && /^[a-zA-Z0-9 ,"'_-]+$/u.test(theme.fontFamily)
    ? theme.fontFamily : 'system-ui,sans-serif';
  const scheme = theme.colorScheme === 'dark' ? 'dark' : theme.colorScheme === 'light' ? 'light' : 'light dark';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">`
    + `html{color-scheme:${scheme}}body{margin:0;font:14px/1.6 ${family};color:${color};background:${background}}`
    + '.display-root{padding:12px;overflow:auto;overflow-wrap:anywhere;max-width:100%;box-sizing:border-box}'
    + '.display-root *{box-sizing:border-box;max-width:100%}table{border-collapse:collapse}td,th{padding:6px;text-align:start}'
    + 'input,select,textarea,button{font:inherit}input,select,textarea{min-height:32px}button{min-height:32px;cursor:pointer}'
    + 'pre{white-space:pre-wrap}fieldset{min-width:0} :focus-visible{outline:2px solid Highlight;outline-offset:2px}'
    + '</style></head><body><div class="display-root" id="display-root"></div>'
    + `<script type="application/json" id="display-seed">${json}</script>`
    + `<script nonce="${nonce}">(${workbenchFrameBootstrap.toString()})();</script></body></html>`;
}

/** This function is serialized as trusted code. Keep all dependencies inside;
 * the generated source is never evaluated or inserted into the live document. */
function workbenchFrameBootstrap() {
  const seed = JSON.parse(document.getElementById('display-seed')!.textContent!) as FrameSeed;
  document.getElementById('display-seed')!.remove();
  const root = document.getElementById('display-root')!;
  let port: MessagePort | null = null, sequence = 0, bound = false, rendered = false;
  let sentAt = performance.now(), sent = 0;
  const controls = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
  const fields = new Map(seed.fields.map(field => [field.fieldId as string, field]));
  const tags = new Set(('div section article header footer main aside nav p h1 h2 h3 h4 h5 h6 span strong em b i u s small mark '
    + 'code pre blockquote ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td hr br details summary '
    + 'form label input select option optgroup textarea button fieldset legend a').split(' '));
  const properties = new Set(('display flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-content align-self '
    + 'justify-content justify-items justify-self gap row-gap column-gap grid-template-columns grid-template-rows grid-auto-flow '
    + 'grid-column grid-row width min-width max-width height min-height max-height padding padding-top padding-right padding-bottom '
    + 'padding-left margin margin-top margin-right margin-bottom margin-left border border-width border-style border-color '
    + 'border-radius border-top border-right border-bottom border-left background background-color color font font-size font-weight '
    + 'font-style font-family line-height letter-spacing text-align text-decoration white-space overflow overflow-x overflow-y '
    + 'overflow-wrap word-break vertical-align list-style-type table-layout border-collapse opacity').split(' '));
  const functions = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'calc', 'min', 'max', 'clamp', 'repeat', 'minmax']);
  let cssSequence = 0;
  const css: string[] = [];
  const fail = (reason: 'invalid_code' | 'resource_limit' | 'unsupported') => {
    root.replaceChildren(); rendered = false;
    try { send({ kind: 'render_failed', reason }); } finally { port?.close(); port = null; }
  };
  const send = (message: Record<string, unknown>) => {
    const now = performance.now(); if (now - sentAt >= 60000) { sentAt = now; sent = 0; }
    if (++sent > seed.limits.messagesPerMinute) throw Error('resource_limit');
    const packet = { draftVersion: seed.version, binding: seed.binding, sequence: ++sequence, ...message };
    if (new TextEncoder().encode(JSON.stringify(packet)).byteLength > seed.limits.messageBytes) throw Error('resource_limit');
    if (port) port.postMessage(packet); else window.parent.postMessage(packet, seed.parentOrigin);
  };
  const style = (text: string) => {
    if (text.length > 4096 || /[\\@\u0000-\u001f\u007f{}<>]/u.test(text)) throw Error('invalid_code');
    const parsed = document.createElement('span').style;
    for (const declaration of text.split(';')) {
      if (!declaration.trim()) continue;
      const colon = declaration.indexOf(':'); if (colon < 1) throw Error('invalid_code');
      const property = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
      if (!properties.has(property) || !value || value.length > 256 || /!important/iu.test(value)
        || /[^a-zA-Z0-9 #.,%()+*/'"_-]/u.test(value)) throw Error('invalid_code');
      let depth = 0;
      for (const char of value) { if (char === '(' && ++depth > 4 || char === ')' && --depth < 0) throw Error('invalid_code'); }
      if (depth !== 0) throw Error('invalid_code');
      for (const call of value.matchAll(/([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\(/gu)) if (!functions.has(call[1].toLowerCase())) throw Error('invalid_code');
      for (const number of value.matchAll(/(-?\d+(?:\.\d+)?)\s*(px|rem|em|vh|vw|fr|%)?/giu)) {
        const n = Number(number[1]), unit = (number[2] ?? '').toLowerCase();
        const max = unit === 'rem' || unit === 'em' ? 64 : ['%', 'vh', 'vw'].includes(unit) ? 100 : unit === 'fr' ? 12 : 1024;
        if (!Number.isFinite(n) || Math.abs(n) > max) throw Error('resource_limit');
      }
      parsed.setProperty(property, value);
      if (!parsed.getPropertyValue(property)) throw Error('invalid_code');
    }
    return parsed.cssText;
  };
  const styleRules = (text: string) => {
    if (text.length > 16384 || /[\\@\u0000-\u001f\u007f<>]/u.test(text)) throw Error('invalid_code');
    let rest = text, count = 0;
    while (rest.trim()) {
      if (++count > 100) throw Error('resource_limit');
      const begin = rest.indexOf('{'), end = rest.indexOf('}', begin + 1);
      if (begin < 1 || end < begin || rest.slice(begin + 1, end).includes('{')) throw Error('invalid_code');
      const selectors = rest.slice(0, begin).trim().split(',');
      if (selectors.length > 20 || selectors.some(selector => selector.length > 200
        || !/^[a-zA-Z0-9_.# >:-]+$/u.test(selector)
        || selector.split(/[ >]+/u).some(part => part && !/^(?:[a-z][a-z0-9-]*)?(?:[.#][a-zA-Z_][a-zA-Z0-9_-]*)*(?::(?:hover|focus|focus-visible|first-child|last-child))?$/u.test(part)))) throw Error('invalid_code');
      css.push(selectors.map(selector => `.display-root ${selector.trim().replace(/#([a-zA-Z_][a-zA-Z0-9_-]*)/gu, '#model-$1')}`).join(',')
        + '{' + style(rest.slice(begin + 1, end)) + '}');
      rest = rest.slice(end + 1);
    }
  };
  const answer = (field: FrameField, value: string) => {
    if (!value) return null;
    if (field.kind === 'integer') {
      if (!/^[1-9][0-9]*$/u.test(value)) throw Error('invalid_code');
      const n = Number(value); if (!Number.isSafeInteger(n) || n < field.minimum || n > field.maximum || n > 1000000) throw Error('invalid_code');
      return { fieldId: field.fieldId, value: n };
    }
    if (field.kind === 'choice' && !field.options.some(option => option.value === value)
      || field.kind === 'text' && value.length > field.maxLength || value.length > 2048) throw Error('invalid_code');
    return { fieldId: field.fieldId, value };
  };
  const candidates = () => {
    if (!rendered || seed.fieldRevision === null) return;
    const answers: AiTaskInputAnswerDraft[] = [];
    for (const [id, control] of controls) {
      const field = fields.get(id)!; if (!field.editable) continue;
      const item = answer(field, control.value); if (item) answers.push(item);
    }
    if (answers.length) send({ kind: 'candidate_input', fieldRevision: seed.fieldRevision, answers });
  };
  let candidateTimer: ReturnType<typeof setTimeout> | null = null;
  const candidateChange = () => {
    if (candidateTimer) clearTimeout(candidateTimer);
    candidateTimer = setTimeout(() => {
      candidateTimer = null;
      try { candidates(); } catch { fail('invalid_code'); }
    }, 300);
  };
  const render = () => {
    const started = performance.now(); let nodes = 0, tableRows = 0;
    const budget = () => { if (performance.now() - started > seed.limits.renderMs || ++nodes > 2500) throw Error('resource_limit'); };
    if (new TextEncoder().encode(seed.source).byteLength > seed.limits.codeBytes) throw Error('resource_limit');
    // Template contents are inert. Rebuilding uses only allowed HTML nodes and
    // validated attributes; the parsed nodes never enter the live document.
    const template = document.createElement('template'); template.innerHTML = seed.source;
    // Controls are rebuilt from the field contract, but their discarded source
    // children still count toward limits and cannot hide scripts or deep trees.
    const pending: Array<{ node: Node; depth: number }> = Array.from(template.content.childNodes, node => ({ node, depth: 1 }));
    let sourceNodes = 0;
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (++sourceNodes > 5000 || depth > seed.limits.componentDepth || performance.now() - started > seed.limits.renderMs) throw Error('resource_limit');
      if (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.COMMENT_NODE) {
        if (!(node instanceof HTMLElement) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
          || !tags.has(node.localName) && node.localName !== 'style') throw Error('invalid_code');
        if (Array.from(node.attributes).some(attr => /^on/iu.test(attr.name)
          || ['src', 'href', 'srcset', 'action', 'formaction', 'target', 'ping', 'poster', 'background'].includes(attr.name.toLowerCase()))) throw Error('invalid_code');
      }
      for (const child of node.childNodes) pending.push({ node: child, depth: depth + 1 });
    }
    const rebuild = (node: Node, depth: number): Node | null => {
      budget(); if (depth > seed.limits.componentDepth) throw Error('resource_limit');
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
      if (node.nodeType === Node.COMMENT_NODE) return null;
      if (!(node instanceof HTMLElement) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') throw Error('invalid_code');
      const tag = node.localName;
      if (tag === 'style') { styleRules(node.textContent ?? ''); return null; }
      if (!tags.has(tag)) throw Error('invalid_code');
      if (tag === 'tr' && ++tableRows > seed.limits.tableRows) throw Error('resource_limit');
      const fieldId = node.getAttribute('data-field-id'), field = fieldId && fields.get(fieldId);
      if (fieldId && (!field || controls.has(fieldId) || !['input', 'select', 'textarea'].includes(tag))) throw Error('invalid_code');
      const output = document.createElement(field ? field.kind === 'choice' ? 'select' : field.kind === 'integer' ? 'input' : tag === 'textarea' ? 'textarea' : 'input' : tag);
      for (const attr of node.attributes) {
        const name = attr.name.toLowerCase(), value = attr.value;
        if (value.length > 2048) throw Error('resource_limit');
        if (name === 'style') { const className = `safe-style-${++cssSequence}`; css.push(`.display-root .${className}{${style(value)}}`); output.classList.add(className); }
        else if (name === 'class' && /^[a-zA-Z0-9_ -]{0,256}$/u.test(value)) for (const name of value.split(/\s+/u).filter(Boolean)) output.classList.add(name);
        else if (name === 'id' && /^[a-zA-Z_][a-zA-Z0-9_-]{0,100}$/u.test(value)) output.id = `model-${value}`;
        else if (name === 'for') output.setAttribute(name, `model-${value}`);
        else if (['aria-labelledby', 'aria-describedby'].includes(name)) output.setAttribute(name, value.split(/\s+/u).map(id => `model-${id}`).join(' '));
        else if (['title', 'aria-label', 'aria-expanded', 'aria-hidden', 'aria-live', 'role'].includes(name)) output.setAttribute(name, value);
        else if (['colspan', 'rowspan', 'span'].includes(name) && /^[1-9][0-9]?$/u.test(value) && Number(value) <= 20) output.setAttribute(name, value);
        else if (['data-field-id', 'data-source-id', 'data-confirmation-index'].includes(name)) output.setAttribute(name, value);
        else if (['type', 'value', 'placeholder', 'name', 'min', 'max', 'maxlength', 'required', 'disabled', 'readonly', 'selected'].includes(name)) {
          if (!['input', 'select', 'option', 'textarea', 'button'].includes(tag)) throw Error('invalid_code');
          if (name === 'placeholder') output.setAttribute(name, value);
          else if (name === 'value' && tag === 'option') output.setAttribute(name, value);
        } else if (name === 'open' && tag === 'details') output.setAttribute(name, '');
        else throw Error('invalid_code');
      }
      if (tag === 'input' && !field || tag === 'select' && !field || tag === 'textarea' && !field) throw Error('invalid_code');
      if (field) {
        const control = output as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        control.disabled = !field.editable;
        control.setAttribute('aria-label', field.label); control.setAttribute('data-field-id', field.fieldId);
        if (field.kind === 'choice') for (const option of [{ value: '', label: '' }, ...field.options]) {
          const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; control.append(item);
        }
        if (field.kind === 'integer') { control.setAttribute('type', 'number'); control.setAttribute('min', String(field.minimum)); control.setAttribute('max', String(field.maximum)); }
        if (field.kind === 'text') control.setAttribute('maxlength', String(Math.min(field.maxLength, 2048)));
        const initial = String(field.initial ?? node.getAttribute('value') ?? (tag === 'textarea' ? node.textContent : '') ?? '');
        if (initial) answer(field, initial); control.value = initial;
        controls.set(field.fieldId, control); control.addEventListener('input', candidateChange);
        control.addEventListener('change', () => { if (candidateTimer) clearTimeout(candidateTimer); candidateTimer = null;
          try { candidates(); } catch { fail('invalid_code'); } });
      } else {
        for (const child of node.childNodes) { const safe = rebuild(child, depth + 1); if (safe) output.append(safe); }
      }
      if (output instanceof HTMLButtonElement) output.type = 'button';
      if (tag === 'form') output.addEventListener('submit', event => { event.preventDefault(); try { candidates(); } catch { fail('invalid_code'); } });
      const source = output.getAttribute('data-source-id'), confirmation = output.getAttribute('data-confirmation-index');
      if (source || confirmation !== null) {
        if (tag !== 'button' && tag !== 'a' || source && !seed.sourceIds.includes(source)
          || source && confirmation !== null
          || confirmation !== null && !/^(0|[1-9][0-9]?)$/u.test(confirmation)) throw Error('invalid_code');
        // The model can ask for review before the business step has prepared a
        // proposal. No current original proposal means no business control.
        if (confirmation !== null && !seed.proposals[Number(confirmation)]) return null;
        output.setAttribute('role', 'button'); output.tabIndex = 0;
        const request = () => { try { if (source) send({ kind: 'request_source', sourceId: source });
          else send({ kind: 'request_confirmation', proposal: seed.proposals[Number(confirmation)] }); } catch { fail('resource_limit'); } };
        output.addEventListener('click', request); output.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') { event.preventDefault(); request(); } });
      }
      return output;
    };
    const fragment = document.createDocumentFragment();
    for (const node of template.content.childNodes) { const safe = rebuild(node, 1); if (safe) fragment.append(safe); }
    template.content.replaceChildren();
    const styles = document.createElement('style'); styles.nonce = seed.nonce; styles.textContent = css.join('\n');
    document.head.append(styles); root.replaceChildren(fragment); rendered = true; budget(); send({ kind: 'rendered' });
  };
  window.addEventListener('message', function connect(event) {
    if (bound || event.source !== window.parent || event.origin !== seed.parentOrigin || event.ports.length !== 1) return;
    const value = event.data;
    if (!value || Object.keys(value).sort().join(',') !== 'binding,draftVersion,kind'
      || value.kind !== 'workbench_bind_port' || value.draftVersion !== seed.version
      || JSON.stringify(value.binding) !== JSON.stringify(seed.binding)) return;
    bound = true; port = event.ports[0]; port.start();
    try { render(); } catch (error) { fail(error instanceof Error && error.message === 'resource_limit' ? 'resource_limit' : 'invalid_code'); }
    window.removeEventListener('message', connect);
  });
  send({ kind: 'ready' });
}

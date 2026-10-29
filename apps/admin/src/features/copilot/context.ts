/** Display-only context projection. Never serialize API records, hidden DOM or credentials.
 * Local locators are not server IDs or authorization; a backend must resolve references again. */
export type CopilotField = { key: string; label: string; value: string };
export type CopilotConfigField = { key: string; label: string; value: string; options?: { value: string; label: string }[] };
export type CopilotRecord = {
  key: string; recordId?: string; source: string; path: string; label: string;
  capturedAt: string; fields: CopilotField[];
  configId?: string; configuration?: CopilotConfigField[];
};

const PRIVATE = /password|secret|token|credential|api.?key|authorization|身份证|证件号|密钥|密码|地址|address|phone|email|手机|电话|邮箱/i;
const FIELD = /name|title|no$|code|status|state|amount|price|balance|total|count|quantity|capacity|version|currency|enabled|active|date|time|At$|customer|items|名称|订单|客户|会员|企业|器材|型号|资产|状态|金额|应付|应收|收款|押金|预授权|库存|数量|计费|价格|租期|时间|日期|领取|归还|取机|还机|等级|权益|优先级|负责人|进度|门店|经营主体|差异|匹配|方案|折扣|有效期|截止|摘要|Summary|Name|Status|Date|Amount|Price|Pickup|Return|Due|Balance|Rate|Plan|Customer|Equipment|Model|Stock|Count|Owner|Priority|Progress|Match|Difference/i;
export const canCaptureField = (key: string, label = key) => !PRIVATE.test(`${key} ${label}`) && FIELD.test(`${key} ${label}`);
export function visibleText(node: Element | null): string {
  if (!(node instanceof HTMLElement) || node.closest('[inert], [aria-hidden="true"]') || !node.getClientRects().length) return '';
  // Animated cells have a visual value plus a screen-reader copy. Skip clipped,
  // transparent and hidden branches so amounts/old transition frames are not duplicated.
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) {
    let ancestor = walker.currentNode.parentElement;
    let visible = true;
    while (ancestor) {
      const style = getComputedStyle(ancestor), rect = ancestor.getBoundingClientRect();
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0
        || (style.position === 'absolute' && rect.width <= 1 && rect.height <= 1)
        || style.clipPath === 'inset(50%)') { visible = false; break; }
      if (ancestor === node) break;
      ancestor = ancestor.parentElement;
    }
    if (visible) parts.push(walker.currentNode.textContent || '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').replace(/([¥$€£])\s+(?=\d)/g, '$1').trim().slice(0, 320)
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/(?<!\d)(1\d{2})\d{4}(\d{4})(?!\d)/g, '$1****$2');
}
export function readRecord(node: HTMLElement, path: string): CopilotRecord | null {
  if (node.closest('[inert], [aria-hidden="true"], [data-copilot-disabled="true"]')) return null;
  const table = node.closest('table');
  const caption = node.closest<HTMLElement>('[data-copilot-source]')?.dataset.copilotSource;
  const source = caption && !/^(数据表格|Data table)$/.test(caption) ? caption : document.querySelector('h1')?.innerText || document.title;
  const fields: CopilotField[] = [];
  const cells = node.querySelectorAll<HTMLElement>('[data-copilot-field], td[data-column-id]');
  for (const cell of cells) {
    // A parent record cannot absorb nested/expanded records.
    if (cell.closest('[data-copilot-record]') !== node) continue;
    const key = cell.dataset.copilotField || cell.dataset.columnId || '';
    const heading = table && Array.from(table.querySelectorAll<HTMLElement>('thead th')).find(th => th.dataset.columnId === key);
    const label = cell.dataset.copilotLabel || visibleText(heading || null) || key;
    const value = visibleText(cell);
    if (value && value !== '—' && canCaptureField(key, label)) fields.push({ key, label, value });
    if (fields.length >= 12) break;
  }
  const label = node.dataset.copilotLabel || fields.find(field => /name|title|no|名称|订单/.test(field.key))?.value || fields[0]?.value;
  const locator = node.dataset.copilotRecord;
  if (!locator || !label) return null;
  return { key: JSON.stringify([path, source, locator]), recordId: node.dataset.copilotId, source,
    path, label: label.slice(0, 100), fields, configId: node.dataset.copilotConfig, capturedAt: new Date().toISOString() };
}
export function readTarget(target: EventTarget | null, path: string): CopilotRecord[] {
  if (!(target instanceof Element) || target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),a,[data-copilot-ignore]')) return [];
  const button = target.closest('button,[role="button"]');
  // Card titles are quick-look triggers, but their right-click still belongs to
  // the whole card. Editing, selection and other operation buttons remain native.
  const cardTitle = target.closest('[data-record-card]') && button?.matches('[aria-haspopup="dialog"]') && button.closest('h2,h3');
  if (button && !button.matches('[data-copilot-reference],article') && !cardTitle) return [];
  if (window.getSelection()?.toString().trim()) return [];
  const node = target.closest<HTMLElement>('[data-copilot-record]');
  if (!node) return [];
  const record = readRecord(node, path);
  if (!record) return [];
  if (node.dataset.state === 'selected' || node.dataset.selected === 'true') {
    const list = node.closest('[data-copilot-list]');
    const selection = list && readSelection(list, path);
    if (selection?.length) return selection;
  }
  return [record];
}
export function readSelection(list: Element, path: string) {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-copilot-record][data-state="selected"], [data-copilot-record][data-selected="true"]'))
    .map(node => readRecord(node, path)).filter((record): record is CopilotRecord => Boolean(record));
}

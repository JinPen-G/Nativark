export type ParagraphBlock = { id: string; type: 'paragraph'; label?: string; text: string };
export type HeadingBlock = { id: string; type: 'heading'; text: string; level?: 2 | 3 };
export type TableBlock = { id: string; type: 'table'; label?: string; columns: string[]; rows: string[][] };
export type PanelBlock = ParagraphBlock | HeadingBlock | TableBlock;
export type PanelPage = { title: string; meta?: string; blocks: PanelBlock[] };
export type PanelChange = { blockId: string; after: PanelBlock };
export type AppliedChange = PanelChange & { before: PanelBlock };
export type PanelRequest = { prompt: string; page: PanelPage; selection?: string; signal: AbortSignal };
export type PanelReply = { text: string | AsyncIterable<string>; change?: PanelChange };
export type PanelRespond = (request: PanelRequest) => PanelReply | Promise<PanelReply>;
export type PanelMessage = { id: string; prompt: string; selection?: string; text: string; status: 'reading' | 'streaming' | 'done' | 'stopped' | 'error'; change?: AppliedChange; changeStatus?: 'proposed' | 'applied' | 'discarded' | 'undone'; error?: string; actionError?: string };
export const clonePage = (page: PanelPage): PanelPage => structuredClone(page);
export const blockEqual = (a: PanelBlock | undefined, b: PanelBlock | undefined) => JSON.stringify(a) === JSON.stringify(b);
export const blockLabel = (block: PanelBlock) => 'label' in block && block.label ? block.label : block.type === 'table' ? 'Table' : block.type === 'heading' ? 'Heading' : 'Paragraph';
export function validateChange(page: PanelPage, change: PanelChange): AppliedChange {
  const before = page.blocks.find(block => block.id === change.blockId);
  if (!before || !change.after || change.after.id !== before.id || change.after.type !== before.type) throw new Error('This suggestion does not match a block on the page.');
  if (change.after.type === 'table') {
    const table = change.after;
    if (!Array.isArray(table.columns) || !table.columns.every(value => typeof value === 'string') || !Array.isArray(table.rows) || !table.rows.every(row => Array.isArray(row) && row.length === table.columns.length && row.every(cell => typeof cell === 'string'))) throw new Error('The proposed table has invalid rows or columns.');
  } else if (typeof change.after.text !== 'string') throw new Error('The proposed text is invalid.');
  return structuredClone({ ...change, before });
}
export function applyPageChange(page: PanelPage, change: AppliedChange): PanelPage {
  const current = page.blocks.find(block => block.id === change.blockId);
  if (!blockEqual(current, change.before)) throw new Error('This part of the page has changed. Ask again before applying this suggestion.');
  validateChange(page, change);
  return { ...page, blocks: page.blocks.map(block => block.id === change.blockId ? structuredClone(change.after) : block) };
}
export function undoPageChange(page: PanelPage, change: AppliedChange): PanelPage {
  if (!blockEqual(page.blocks.find(block => block.id === change.blockId), change.after)) throw new Error('A newer edit changed this block. Undo the newer edit first.');
  return { ...page, blocks: page.blocks.map(block => block.id === change.blockId ? structuredClone(change.before) : block) };
}
export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.match(/\S+\s*/gu) ?? [], b = after.match(/\S+\s*/gu) ?? [];
  if (a.length * b.length > 120000) return [{ kind: 'removed', text: before }, { kind: 'added', text: after }];
  const width = b.length + 1, grid = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) grid[i * width + j] = a[i] === b[j] ? 1 + grid[(i + 1) * width + j + 1] : Math.max(grid[(i + 1) * width + j], grid[i * width + j + 1]);
  const parts: DiffPart[] = [];
  const append = (kind: DiffPart['kind'], text: string) => { const last = parts.at(-1); if (last?.kind === kind) last.text += text; else parts.push({ kind, text }); };
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { append('same', a[i++]); j++; }
    else if (i < a.length && (j >= b.length || grid[(i + 1) * width + j] >= grid[i * width + j + 1])) append('removed', a[i++]);
    else append('added', b[j++]);
  }
  return parts;
}
export const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;

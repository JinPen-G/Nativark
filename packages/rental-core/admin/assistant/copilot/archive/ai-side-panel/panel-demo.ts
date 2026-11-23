import type { PanelPage, PanelRespond, ParagraphBlock, TableBlock } from './panel-state';

export const samplePage: PanelPage = {
  title: 'Team workspaces', meta: 'Product spec · Maya Chen · Edited Oct 18', blocks: [
    { id: 'intro', type: 'paragraph', label: 'Intro', text: 'Team workspaces are a new feature that will make it possible for people who work together to share their projects, files and billing in one single place, so that they no longer need to forward invoices around or invite each other to every project one at a time.' },
    { id: 'goals-heading', type: 'heading', text: 'Goals' },
    { id: 'goals', type: 'paragraph', label: 'Goals', text: 'Cut the time it takes to invite a team from six minutes to under one. Move 30% of paid solo accounts to a team plan by the end of March 2027.' },
    { id: 'pricing-heading', type: 'heading', text: 'Pricing' },
    { id: 'pricing-intro', type: 'paragraph', label: 'Pricing', text: 'Per seat, billed monthly. Admins add or remove seats at any time and changes are prorated on the next invoice.' },
    { id: 'pricing', type: 'table', label: 'Pricing table', columns: ['Plan', 'Seats', 'Monthly'], rows: [['Starter', 'Up to 5', '$12'], ['Team', 'Up to 50', '$24'], ['Business', 'Unlimited', '$36']] },
  ],
};
export const sampleSuggestions = ['Summarize this page', 'Tighten the intro', 'Add an annual price column'];
export const conciseIntro = 'Team workspaces let people share projects, files and billing in one place, without forwarding invoices or inviting each other project by project.';
export const samplePanelRespond: PanelRespond = ({ prompt, page, selection, signal }) => {
  signal.throwIfAborted();
  if (/\[error\]/i.test(prompt)) throw new Error('The assistant did not respond. This is a simulated connection failure.');
  const intro = page.blocks.find(block => block.id === 'intro' && block.type === 'paragraph') as ParagraphBlock | undefined;
  const table = page.blocks.find(block => block.type === 'table') as TableBlock | undefined;
  if (/annual|yearly|年付|年费/i.test(prompt) && table) {
    if (table.columns.includes('Annual')) return { text: 'The pricing table already has an annual column. Annual prices are shown per seat per month, with two months free.' };
    return { text: 'I added an annual column at two months free, shown per seat per month. Business comes to $30, or $360 a seat each year.', change: { blockId: table.id, after: { ...table, columns: [...table.columns, 'Annual'], rows: table.rows.map(row => { const price = Number(row[table.columns.findIndex(column => /monthly/i.test(column))]?.replace(/[^\d.]/g, '')); return [...row, Number.isFinite(price) ? `$${Math.round(price * 10 / 12)}` : '—']; }) } } };
  }
  if (/intro|tighten|shorten|concise|精简|简介/i.test(prompt) && intro && !selection) return { text: 'Here is a tighter intro. It keeps what teams share and the two chores it removes, and goes from 48 words to 22.', change: { blockId: intro.id, after: { ...intro, text: conciseIntro } } };
  if (selection) {
    const block = page.blocks.find(block => block.type === 'paragraph' && block.text.includes(selection)) as ParagraphBlock | undefined;
    if (block && /tighten|shorten|rewrite|improve|精简|改写/i.test(prompt)) {
      const replacement = block.id === 'intro' ? conciseIntro : selection.replace(/\s+/g, ' ').trim();
      return { text: 'Here is a more concise version of the selected passage. Review the highlighted words before applying it.', change: { blockId: block.id, after: { ...block, text: block.id === 'intro' ? replacement : block.text.replace(selection, replacement) } } };
    }
    return { text: `The selected passage belongs to ${block?.label ?? page.title}. It provides context for this document.\n\n> ${selection}\n\nYou can ask me to explain it or propose a shorter version. This response uses only the local page.` };
  }
  return { text: `${page.title} let people share projects, files and billing in one place.\n\nThe spec sets two goals: invite a team in under a minute, and move 30% of paid solo accounts to a team plan by March 2027. Pricing is per seat, from $12 on Starter to $36 on Business${table?.columns.includes('Annual') ? ', with two months free when billed annually' : ''}.` };
};

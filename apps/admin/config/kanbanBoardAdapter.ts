import type { Plugin } from "vite";

/** Keeps the archived Pro preview intact while adding business callbacks and deferred keyboard commits. */
export function adaptKanbanRuntime(source: string, filename: string) {
  if (!filename.endsWith("/components/kanban-board/archive/reference-runtime.js") && !filename.endsWith("/components/kanban-board/archive/dropdown-runtime.js")) return undefined;
  let code = source.replaceAll("\r\n", "\n");
  const replace = (before: string, after: string, count = 1) => {
    if (code.split(before).length - 1 !== count) throw new Error(`Kanban archive contract changed: ${before.slice(0, 100)}`);
    code = code.replaceAll(before, after);
  };
  replace("import { useSplitReducedMotion } from '../split-bar/useSplitMotion';", "import { usePrefersReducedMotion as useSplitReducedMotion } from '@/lib/usePrefersReducedMotion';");
  replace("import motionTokens from '../reasoning-tree/motion-tokens.json';", "import motionTokens from './motion-tokens.json';");
  if (filename.endsWith("dropdown-runtime.js")) return code;
  replace("import { ReferenceImage } from '../agent-cursor/ReferenceImage';", "import { ReferenceImage } from './ReferenceImage';\nimport { useKanbanBridge, useKanbanAnnouncement } from '../KanbanBridge';");
  replace('className: x }) { const frames', 'className: x }) { const business = useKanbanBridge(); const [keyboardDraft, setKeyboardDraft] = (0, i.useState)(null); const frames');
  replace('P = t ?? I,', 'P = keyboardDraft ?? t ?? I,');
  replace('[et, en] = (0, i.useState)("")', '[et, en] = useKanbanAnnouncement()');
  replace('function ({ card: e, person: a, lifted: t }) { let i =', 'function ({ card: e, person: a, lifted: t }) { const business = useKanbanBridge(); if (business.renderCard) return business.renderCard(e, a, t); let i =');
  replace('function M({ uid: e, card: a, columns: t, people: r, onClose: l, onChange: o }) { let d =', 'function M({ uid: e, card: a, columns: t, people: r, onClose: l, onChange: o }) { const business = useKanbanBridge(); let d =');
  replace('reducedMotion: "user"', 'reducedMotion: N ? "always" : "never"');
  replace('if (0 !== e.button || q.current || Q)', 'if (business.disabled || 0 !== e.button || q.current || Q)');
  replace('onKeyDown: n => { if ("Enter"', 'onKeyDown: n => { if (business.disabled) return; if ("Enter"');
  replace('t.preventDefault(), V(null), en(`Dropped ${n.title} in ${eb(n.column)}.`);', 't.preventDefault(), F(R.current), setKeyboardDraft(null), V(null), en(`Dropped ${n.title} in ${eb(n.column)}.`);');
  replace('t.preventDefault(), F(Q.snapshot), V(null), en(`${n.title} returned.`), eN(n.id);', 't.preventDefault(), R.current = Q.snapshot, setKeyboardDraft(null), V(null), en(`${n.title} returned.`), eN(n.id);');
  replace('F(c); let u = T(o)', 'R.current = c; setKeyboardDraft(c); let u = T(o)');
  replace('eI = e => { eu.current = e, J(e); }', 'eI = e => { if (business.onOpen) business.onOpen(e); else { eu.current = e; J(e); } }');
  replace('onClick: () => { ea(""), G(C(e.id, "assignee" === H ? f : void 0)); }', 'disabled: !business.canCreate(e.id), onClick: () => business.onCreate(e.id, "assignee" === H ? f : undefined)');
  replace('onClick: () => { ea(""), G(r); }', 'disabled: !business.canCreate(T(r).column), onClick: () => business.onCreate(T(r).column, T(r).lane)');
  replace('"aria-label": `Add card to ${e.name}`', '"aria-label": business.t("在{column}新建工单", {column:e.name})');
  replace('"aria-label": "Group by"', '"aria-label": business.t("看板分组")');
  replace('"aria-roledescription": "Draggable card"', '"aria-roledescription": business.t("可拖动工单")');
  replace('`${t.title}, ${t.id}, ${eg.get(t.assignee)?.name ??', '`${t.title}, ${business.cardLabel(t)}, ${eg.get(t.assignee)?.name ??');
  replace('className: A().cardId, children: a.id', 'className: A().cardId, children: business.cardLabel(a)');
  replace('"Unassigned"', 'business.t("未派工")', 2);
  replace('"status" === e ? "Status" : "Swimlanes"', '"status" === e ? business.t("按状态") : business.t("按负责人")');
  replace('" cards"', 'business.t("张工单")');
  replace('`${a} cards`', 'business.t("{count}张工单", {count:a})');
  replace('`${i.name} lane`', 'business.t("{name}的工单", {name:i.name})');
  replace('children: "Over limit"', 'children: business.t("超出在制上限")');
  replace('"aria-label": "Close details"', '"aria-label": business.t("关闭详情")');
  replace('" Add card"', 'business.t("新建工单")');
  const detailStart = '(0, n.jsx)("textarea", { ref: g, className: A().titleInput';
  const detailEnd = '] })] }); }\nlet $ = E;';
  const start = code.indexOf(detailStart);
  const end = code.indexOf(detailEnd, start);
  if (start < 0 || end < 0) throw new Error("Kanban detail-body slot changed");
  code = code.slice(0, start) + 'business.renderDetails ? business.renderDetails(a, l) : (0, n.jsxs)(n.Fragment, { children: [' + code.slice(start, end) + '] })' + code.slice(end);
  return code;
}

export function kanbanBoardAdapter(): Plugin {
  return {
    name: "rental-kanban-business", enforce: "pre",
    transform(source, id) {
      const code = adaptKanbanRuntime(source, id.replaceAll("\\", "/").split("?")[0]);
      return code === undefined ? undefined : { code, map: null };
    }
  };
}

# UIArc Kanban board integration

Source: [UIArc Pro Kanban board](https://uiarc.dev/components/blocks/kanban-board).

The owner authorized reuse of the complete local implementation from
`D:/工作文件/uiarc-pro-archive/preview/src/components/kanban-board` on 2026-11-08.
The fixed copies in `archive/` preserve that implementation and its provenance.
They are the public compiled preview plus the archive's local adapters, not the
protected original Pro TSX. No protected registry or token was accessed.

- `archive/reference-runtime.js` SHA-256: `017b7cdda46945ab120afc39ddcc833c805dac9948c73c41b84a7727b4b50e13`.
- `archive/original.css` SHA-256: `bedb067add36675666cb19151e4e3f610bbc7f38f541b47b7d4a4f9f592a365c`.
- The local archive's public URLs and upstream hashes are in `archive/provenance.json`.
- `ReferenceImage.tsx` and `motion-tokens.json` are fixed copies of the archive's shared dependencies.

`KanbanBoard.tsx` retains controlled props, cloned data, validation and keyboard
group navigation. The guarded Vite adapter in
`../../../config/kanbanBoardAdapter.ts` connects the existing app motion policy,
localization, card actions, create command and full-height detail overlay without
editing the preserved archive. Pointer lift/tilt, placeholder, live counts,
spring-to-slot release, touch hold, edge scrolling, column ordering and assignee
swimlanes remain the archived implementation. Keyboard arrows update a local
preview; only Space/Enter commits and Escape cancels without a business callback.

`WorkOrderBoard` maps actual authorized work orders to those props. Cross-column
or assignee drops request the existing start, submit, review, cancel or assign
operation. Submit, review, cancel and assignment keep their existing forms and
required evidence. Status changes render from authoritative query results.
Same-column order is a browser-session preference scoped to tenant, workspace,
account and authorization; it is not a shared business priority or status.

The original generic demo's free title/checklist editing, sample people and
sample tasks are not business facts. They remain in the preserved source; the
business integration uses original task forms and explicitly authorized slots.
WIP limits remain supported by the component but no unconfigured limit is invented.

Verification: `node --test tests/admin-work-order-board.test.cjs` exercises actual
adapted keyboard handlers, scope-independent workflow gates and immutable ordering.
Browser evidence and its limits are recorded in the existing management-backend
development record; local tests do not prove real financial or inventory writes.

# Admin UI component conventions

- Use React. Do not introduce Vue or a second admin UI framework.
- Existing and new page-level buttons, plain inputs, tabs, segmented controls, menus, tooltips and compatible drawers import from `@/components/ui`.
- Date/time/color fields, document editors, uploads, pagination, tables, alerts, steps and progress also use the adapter entry. Keep explicit compatibility fallbacks; never replace business table/transport semantics with a visual-only demo.
- Rich documents use the shared safe-node codec, not raw HTML. Keep all consuming client readers in sync, preserve plain-text documents, and validate the existing API character limit before saving.
- Original public UIArc source and its motion/themes are reserved in `packages/ui-arc/vendor`; consult its README and manifest before adding another component.
- Consult `packages/ui-arc/COMPONENTS.md` and run `node scripts/audit-admin-components.cjs --json` for current source/import/hash inventory. Basic multiple selects and standalone checkboxes use adapters; slider uses the native Arc API. Distinguish downloaded, referenced and compatibility-fallback status.
- Do not edit vendor styles or motion to recreate an approximation. Integration, tenant colors/radii, locale, permissions and sound belong to adapters/tokens.
- Preserve AntD Form validation, disabled context, nullable values, ref behavior, async failures and keyboard access. Fall back explicitly if a registry component lacks an existing business capability.
- Destructive inline actions use ConfirmAction and await the real API promise. Never invent Undo or display success before the request completes.
- Saves use SaveButton (validateFields + mutateAsync); other promise-returning commands use ActionButton. Preserve all existing payload transforms and domain checks. Never pass fire-and-forget mutate(), form.submit(), swallowed failures or timers as an operation promise.
- Import reserved components individually. Do not bundle the whole catalog or install malformed/unreviewed dependency entries.
- Pro source is not present and requires authorization/license before use.

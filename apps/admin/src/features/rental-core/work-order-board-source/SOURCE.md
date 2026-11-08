# Maintenance work-order lanes

Selected after inspecting https://uiarc.dev/components/blocks/kanban-board on 2026-11-08.
The source archive contains a complete public preview, including local drag-and-drop and simulated edits.
The original CSS and class map are preserved here from
`D:/工作文件/uiarc-pro-archive/preview/src/components/kanban-board`.
CSS SHA-256: `bedb067add36675666cb19151e4e3f610bbc7f38f541b47b7d4a4f9f592a365c`.

This folder preserves the earlier CSS-only integration snapshot. The active board now
uses the complete local preview runtime through
[`components/kanban-board`](../../../components/kanban-board/SOURCE.md), including
dragging, keyboard movement, assignee swimlanes and spring-to-slot motion.
The owner requested that task quick actions remain on cards and details open in the
app's full-height side sheet. Existing Core operations own status and assignment;
required result/review forms open after the corresponding drop. No demo data or
unconfigured WIP limits enter the business view.

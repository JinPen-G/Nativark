# AI chat implementation

Entry: `AiChat.tsx` (named and default export). Runtime dependencies: React, lucide-react, react-markdown. Copy this directory and `../shared/` together. The gallery exposes eight implementation/source files including `ToolCall.tsx` and the two shared mark files. Styles are imported by the entry; the archived CSS is not imported.

The public reference was inspected on 2026-10-26 and the complete tool examples were restored on 2026-10-27 at the user's request. The default conversation now contains both database turns, four web resources, both search queries, source domains and marks, SQL input and its row-count result. Reference model names and vector marks are sample content; no model provider or database service is connected. The gallery shell preserves its neutral identity.

`chat-state.ts` stores conversation branches; version changes select an existing sibling and restore its descendant path. `chat-demo.ts` provides abortable local events. `ToolCall.tsx` renders independent pill toggles and full-width search/query panels. `ChatMarkdown.tsx` renders safe Markdown links, numbered citations, source rows and code-copy controls with language labels. `chat.css` uses shared theme variables with fallback values and reduced-motion overrides.

The responder is an async iterable of `ChatStreamEvent`, receives only the visible message path and an AbortSignal. Applications should honor that signal. Local attachments expose metadata and an optional object URL thumbnail, not server file IDs or uploaded content. Add a business adapter for real uploads or model calls. No chat, attachment or feedback persistence is provided.

Interactive usage and props: `preview/public/docs/ai-chat.md` (available in the local gallery's documentation tab).

Validation: `node --experimental-strip-types --test scripts/ai-chat.test.mjs` from `preview/` on Node 24. Tests cover restoring old continuations after edit/retry, isolated stream updates, tool completion, abort and safe source URLs. Browser evidence and review are under `.impeccable/review/ai-chat/` at the archive root. This folder is source code, not recovered vendor Pro TypeScript.

Retain relevant dependency license files when transferring to another project: `preview/public/licenses/React-LICENSE.txt`, `Lucide-LICENSE.txt`, `ReactMarkdown-LICENSE.txt`, together with the target project's dependency notices. Those notices are not visual gallery branding.

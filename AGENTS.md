<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes (DJ/VJ Studio)

- Verify with `npx tsc --noEmit -p .` and `npm run lint` (ESLint 9 flat config; `.playwright-mcp/` and `public/sw.js` are ignored).
- `npm run dev` → http://localhost:3000. The app needs a user gesture (StartGate) before audio runs; UI can be exercised with the Playwright MCP.
- Audio lives only in IndexedDB (`src/lib/db.ts`); browsers that cannot persist `Blob` fall back to a packed `ArrayBuffer` record (`src/lib/blob-storage.ts`). The zustand store in `src/lib/store.ts` owns all actions. Per-track performance data (cues / loop / cue point / mixOut / BPM / beat grid) is saved on `TrackMeta`.
- Built-in sampler kit: bump `KIT_VERSION` in `store.ts` whenever `DEFAULT_SAMPLES` gains entries so existing users get them.
- DevDay presets (`src/lib/vj/devday.ts`) follow the official DevDay 2026 palette (#04b84c / #924ff7 / #006aff / #ff8549 / #ffc9b8); keep product copy in sync with openai.com/index/devday-2026-recap.
- Tests: `npm test` runs `node --test tests/` (Node 26 strips TypeScript natively, no extra deps). Test files import leaf modules with explicit `.ts` extensions and live outside the Next typecheck (`tsconfig.exclude`). Keep tests to modules without Web Audio / DOM (key, zip, types, pure helpers). `npm run test:audio` builds the app and measures real master output in a browser (`scripts/audio-check.mjs`, Playwright; `AUDIO_TEST_ENGINE=webkit` for Safari).
- Session restore: a snapshot (decks / crossfader / Auto DJ / plan) is written to `localStorage["session"]` every 5 s and on pagehide; `init()` offers "続きから再開" if it is < 30 min old.
- Heavy per-track analyses (chorus / intro / vocals / LUFS) are queued through `idle()` in `store.ts` so they run one per idle slot instead of blocking the UI together.

# Working on vigo

vigo is an agent-first video engine: HTML scenes → Chromium frames → ffmpeg.
The public contract is the JSON timeline and the deterministic seek behavior.
Do not break either without updating `src/guide.ts`, `README.md`, and tests.

## Commands

```bash
npm install
npm run build      # tsc -> dist/, then chmod the CLI
npm test           # build + node:test (renders real video; needs ffmpeg + Chromium)
npm run demos      # regenerate the narrated demo videos (needs edge-tts)
npm run pages      # publish index.html + assets/ to the gh-pages branch
node dist/cli.js doctor
node dist/cli.js render examples/hello/vigo.json -o /tmp/hello.mp4 \
  --width 640 --height 360 --fps 15
```

## Layout

- `src/core/` — timeline types, normalization, validation, edit operations.
- `src/render/browser.ts` — Chromium launch and the seek runtime.
- `src/render/render.ts` — per-frame capture, layer ordering, temp frames.
- `src/render/encode.ts` — ffmpeg composite graph, audio mix, codecs.
- `src/media/` — probe/convert/concat/frames/thumb.
- `src/cli.ts` — hand-rolled argument parser; keep `--json` clean on stdout.
- `src/mcp/server.ts` — MCP tools; schemas must stay agent-friendly.
- `test/*.test.mjs` — runs against `dist/`; build first.
- `index.html` + `assets/` — GitHub Pages landing site (served from the `gh-pages` branch).
- `assets/icon*.svg`, `favicon.ico` — brand marks; keep the palette in sync with the site.

## Invariants

1. Frame capture is deterministic. CSS/WAAPI animations are paused and seeked;
   `window.vigo.seek(t)` is called for JS motion. Never introduce wall-clock
   state into the render path.
2. Timeline clips are half-open (`start <= t < start + duration`) and clips on
   one track cannot overlap.
3. Visual tracks composite in array order; audio tracks mix.
4. Width/height stay even for H.264/yuv420p.
5. All paths resolve relative to the project file unless absolute.
6. Edit operations preserve source intent: splitting adjusts `offset`.
7. CLI `--json` writes only JSON to stdout; progress and diagnostics go to stderr.

## Verification

- Run `npm test` after changes.
- Render a small example and probe the output for expected duration/dimensions.
- For renderer changes, check a frame before/after a clip boundary and confirm
  transparent HTML padding shows the composition background, not black.
- For audio changes, probe the output audio stream duration; it must match the
  composition (within one AAC frame), not stop at the last clip.

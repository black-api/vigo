---
name: vigo
description: Create, edit, and render videos with vigo — agent-first HTML-to-video and JSON timelines. Use when asked to make a promo, explainer, title card, social clip, captioned scene, or any video built from HTML, when editing/trimming/concatenating existing footage, or when a project should be rendered through the vigo CLI or MCP server.
---

# vigo

vigo turns HTML scenes into deterministic video frames with headless Chromium,
then composites and encodes with ffmpeg. Videos are editable JSON timelines, not
binary project files.

Read the full contract first:

```bash
vigo guide
```

Or read the MCP resource `vigo://guide`.

## Workflow

1. **Check the environment** — `vigo doctor`. If Chromium is missing, set
   `VIGO_CHROME=/path/to/chrome`.
2. **Choose the shape**
   - One HTML file → `vigo html2video scene.html -o out/scene.mp4 --duration 6`
   - Multiple scenes / layers / audio → create or edit a project timeline.
3. **Design for the render size.** Use `vw`/`vh`, full-bleed `html, body`, and
   local fonts. Any size is valid, but width/height must be even.
4. **Animate deterministically**
   - CSS keyframes and WAAPI are paused and seeked automatically.
   - JS motion must expose `window.vigo.seek(t)` (seconds, local to the scene).
   - Never use `requestAnimationFrame` or `Date.now()` for rendered state.
5. **Render** with `--json` and inspect `ok`, `duration`, `width`, `height`.
6. **Verify the artifact** with `vigo probe`, `vigo thumb`, or
   `vigo frames`; do not claim success from exit code alone.
7. **Iterate on the JSON**, not the MP4: `trim`, `split`, `move`, `set`, `rm`.

## Timeline essentials

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 10,
  "background": "#0b0d12",
  "tracks": [
    { "id": "main", "type": "html", "clips": [
      { "id": "intro", "kind": "html", "src": "scenes/intro.html", "start": 0, "duration": 5 }
    ]},
    { "id": "media", "type": "media", "clips": [
      { "id": "broll", "kind": "video", "src": "broll.mp4", "start": 2, "duration": 3, "offset": 1, "fit": "cover" }
    ]},
    { "id": "audio", "type": "audio", "clips": [
      { "id": "music", "kind": "audio", "src": "music.mp3", "start": 0, "duration": 10, "volume": 0.7, "fadeOut": 2 }
    ]}
  ]
}
```

- Clips on one track cannot overlap. Use another visual track to layer.
- Visual tracks composite in array order (first = bottom).
- Timing is `start <= t < start + duration`.
- `offset` trims into the source.
- Paths are relative to the project JSON. Remote URLs are rejected.
- `content` inside a scene can use SVG, canvas, `<video>`, images, and CSS.

## CLI cheatsheet

```bash
vigo init my-video --name demo --duration 8
vigo add my-video/vigo.json --track main --src scenes/intro.html --duration 5
vigo add my-video/vigo.json --src music.mp3 --volume 0.6 --fade-out 2
vigo render my-video/vigo.json -o out/demo.mp4 --json
vigo trim my-video/vigo.json intro --duration 3
vigo split my-video/vigo.json intro --at 1.5
vigo move my-video/vigo.json intro-b --to 4
vigo set my-video/vigo.json intro-b label=outro
vigo rm my-video/vigo.json intro-b
vigo convert raw.mov -o clip.mp4 --width 1280
vigo concat a.mp4 b.mp4 -o joined.mp4
vigo thumb joined.mp4 -o poster.png --at 2
vigo frames joined.mp4 -o frames/ --fps 2
vigo probe joined.mp4 --json
```

All commands support `--json`. Progress goes to stderr. Exit codes: 0 ok,
1 failure, 2 usage.

## MCP

```json
{ "mcpServers": { "vigo": { "command": "vigo", "args": ["mcp"] } } }
```

Prefer `vigo_create_project` (with `scenes`) → `vigo_add_clip` → `vigo_edit` →
`vigo_render` for multi-scene work, and `vigo_html_to_video` for a single scene.
`vigo_get_project` returns the exact timeline before editing.

## Worked examples

Complete projects ship with the repo — read them before designing scenes:

- `examples/ad/` — 33s product ad: 6 HTML scenes, music bed, voiceover track.
- `examples/explainer/` — 2m51s narrated walkthrough: 10 scenes, captions, voice.
- `examples/hello/` — minimal 3-scene starter.

Each project keeps `vigo.json` (the timeline), `scenes/*.html`, `audio/*`, and a
`script.md` with the narration and per-scene timings. Rebuild the narrated ones
with `node scripts/build-demos.mjs` (needs Edge TTS, ffmpeg, Chromium).

## Common mistakes

- Using rAF for animation: frames will be wrong. Use the seek hook.
- Forgetting `margin: 0` on `body`: a white border shows up.
- Odd width/height: H.264 encoding fails; use even numbers.
- Overlapping clips on one track: validation rejects it; use a new track.
- Referencing remote fonts/assets that never finish loading: embed or download.
- Rendering HTML from an untrusted source: it executes JavaScript locally.

export const GUIDE_MARKDOWN = `# vigo

vigo is a lightweight, agent-first video engine. A video is a JSON timeline of
HTML scenes, media clips, and audio. Rendering is deterministic: headless
Chromium seeks each HTML scene frame by frame, then ffmpeg composites and
encodes. The output stays editable because the project stays JSON.

## Install / run

\`\`\`bash
npm install
npm run build
node dist/cli.js doctor
\`\`\`

Requirements: Node 20+, ffmpeg/ffprobe, and Chromium (or Chrome). Set
\`VIGO_CHROME=/path/to/chrome\` if auto-detection fails.

## Quick starts

HTML file -> video:

\`\`\`bash
vigo html2video scene.html -o out/scene.mp4 --duration 6 --fps 30
vigo html2video scene.html -o out/scene.mp4 --audio music.mp3 --fade-out 1
\`\`\`

Project timeline:

\`\`\`bash
vigo init my-video
vigo add my-video/vigo.json --track main --src scenes/intro.html --duration 5
vigo add my-video/vigo.json --track main --src scenes/body.html --duration 8
vigo render my-video/vigo.json -o out/my-video.mp4
\`\`\`

Edit and convert:

\`\`\`bash
vigo trim my-video/vigo.json intro --duration 3
vigo split my-video/vigo.json body --at 8   # --at is absolute timeline time
vigo move my-video/vigo.json body-b --to 9  # --to is the new timeline start
vigo convert raw.mov -o clip.mp4 --width 1280
vigo concat a.mp4 b.mp4 -o joined.mp4
vigo thumb clip.mp4 -o poster.png --at 1.5
vigo frames clip.mp4 -o frames/ --fps 2
\`\`\`

## Timeline format

\`\`\`json
{
  "version": 1,
  "name": "demo",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 10,
  "background": "#0b0d12",
  "tracks": [
    {
      "id": "main",
      "type": "html",
      "clips": [
        { "id": "intro", "kind": "html", "src": "scenes/intro.html", "start": 0, "duration": 5 }
      ]
    },
    {
      "id": "overlay",
      "type": "html",
      "clips": [
        { "id": "lower-third", "kind": "html", "src": "scenes/lower-third.html", "start": 5, "duration": 5 }
      ]
    },
    {
      "id": "media",
      "type": "media",
      "clips": [
        { "id": "broll", "kind": "video", "src": "assets/broll.mp4", "start": 2, "duration": 3, "offset": 1, "fit": "cover" }
      ]
    },
    {
      "id": "audio",
      "type": "audio",
      "clips": [
        { "id": "music", "kind": "audio", "src": "assets/music.mp3", "start": 0, "duration": 10, "volume": 0.7, "fadeOut": 2 }
      ]
    }
  ]
}
\`\`\`

Rules:
- Clips on one track cannot overlap. Use another track to layer.
- Visual tracks composite in array order (first = bottom). Audio tracks mix.
- Timing is half-open: a clip covers \`start <= t < start + duration\`.
- \`offset\` trims into the source. For HTML it is local scene time.
- \`duration\` on the composition is optional; otherwise it ends at the last clip.
- Width/height must be even for H.264.
- Paths are relative to the project file, unless absolute.
- Media clips scale to the frame: \`fit\` is \`contain\` (default), \`cover\`, or \`fill\`.
- Audio supports \`volume\`, \`fadeIn\`, \`fadeOut\` in seconds.

## Making HTML scenes that animate well

vigo freezes time. On every frame it:
1. pauses every CSS/WAAPI animation and seeks it to \`t\`,
2. pauses and seeks \`<video>\`/\`<audio>\` elements,
3. calls your optional hook with the local scene time in seconds.

Prefer CSS animations/keyframes. For JS-driven motion, expose one of:

\`\`\`js
window.vigo = {
  seek(t) {
    // Set the scene state for time t. Do not use requestAnimationFrame.
    title.style.transform = \`translateY(\${Math.max(0, 40 - t * 80)}px)\`;
  }
};
\`\`\`

Optional readiness gate:

\`\`\`js
window.vigo = { ready: document.fonts.ready, seek(t) { /* ... */ } };
\`\`\`

Use viewport units (\`vw\`, \`vh\`, \`%\`) and keep the stage full-bleed:
\`html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }\`.
Fonts must be installed locally or embedded; remote requests may not finish.

Inline HTML is supported on html clips with \`"html": "<!doctype html>..."\`.
Inline scenes cannot load relative assets.

## Commands (agent-friendly, all support --json)

\`\`\`
vigo doctor
vigo init [dir|project.json] [--name] [--width] [--height] [--fps] [--duration] [--force]
vigo render <project> [-o out.mp4] [--width] [--height] [--fps] [--duration]
             [--crf 20] [--preset medium] [--frames-dir dir] [--keep-frames]
             [--frame-format png|jpeg]
vigo html2video <scene.html|-> [-o out.mp4] [--html '<html>...'] [--duration 5]
             [--fps 30] [--width] [--height] [--background] [--audio file]
             [--audio-volume] [--audio-start] [--fade-in] [--fade-out]
             [--frame-format png|jpeg]
vigo convert <input> -o <output> [--start] [--duration] [--width] [--height] [--fps] [--crf] [--no-audio]
vigo concat <input...> -o <output> [--width] [--height] [--fps]
vigo probe <input>
vigo thumb <input> [-o out.png] [--at 2] [--width 1280]
vigo frames <input> -o <dir> [--fps 1] [--start] [--duration] [--width] [--format png|jpg]
vigo add <project> --track main --src file [--html] [--start] [--duration] [--offset]
             [--kind html|video|image|audio] [--fit] [--opacity] [--volume] [--fade-in] [--fade-out]
vigo trim <project> <clipId> [--start] [--duration] [--end] [--offset]
vigo split <project> <clipId> --at <seconds>
vigo move <project> <clipId> --to <seconds>
vigo rm <project> <clipId>
vigo set <project> <clipId> key=value [...]
vigo track add <project> --type html|media|audio [--id name]
vigo track rm <project> <trackId>
vigo inspect <project>
vigo check <project>
vigo mcp
vigo guide
\`\`\`

Every render/edit command returns either human text or JSON with \`--json\`.
Progress goes to stderr, so stdout stays machine-readable.

Performance: \`--frame-format jpeg\` bakes the composition background and
captures JPEG frames instead of transparent PNGs (about 2x faster). It is only
valid for a single HTML layer with no media clips; use PNG when you need alpha.

## MCP

Register vigo with any MCP-capable agent:

\`\`\`json
{
  "mcpServers": {
    "vigo": {
      "command": "vigo",
      "args": ["mcp"]
    }
  }
}
\`\`\`

Tools: \`vigo_doctor\`, \`vigo_create_project\`, \`vigo_get_project\`,
\`vigo_write_scene\`, \`vigo_add_clip\`, \`vigo_edit\`, \`vigo_render\`,
\`vigo_html_to_video\`, \`vigo_convert\`, \`vigo_probe\`, \`vigo_thumbnail\`,
\`vigo_extract_frames\`, \`vigo_concat\`.
Resource: \`vigo://guide\` (this document).

## Practical notes

- Render speed is dominated by Chromium PNG screenshots. Lower fps/width or
  use \`--frames-dir\` to inspect frames.
- Frames are staged in a temp directory and deleted after encoding.
- HTML runs local scripts in Chromium. Treat HTML from untrusted sources
  like any untrusted code.
- For final delivery prefer MP4 (H.264/AAC). WebM (VP9/Opus) is available.
`;

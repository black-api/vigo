# vigo explainer — narration

Voice: `en-US-AndrewMultilingualNeural` (Edge neural TTS)
Total: 2:51 (171.41s)

| # | Scene | Start | Length | Narration |
| --- | --- | --- | --- | --- |
| 1 | gap | 0:00 | 16.3s | AI agents can write code, docs, and entire apps. Video was the missing output. Vigo closes that gap: a lightweight engine that turns HTML scenes and a JSON timeline into a real, editable video. |
| 2 | model | 0:16 | 18.5s | The mental model is simple. A video is a JSON timeline. Visual tracks stack in order. Each clip has a start, a duration, and an offset. HTML clips are scenes. Media clips are footage. Audio tracks are mixed underneath. |
| 3 | determinism | 0:34 | 22.6s | Rendering is deterministic. Vigo opens each scene in headless Chromium and freezes time. It pauses and seeks every CSS and Web Animation, seeks video elements, then calls your optional vigo dot seek hook. Every frame is captured at an exact timestamp, so repeated renders match. |
| 4 | composite | 0:57 | 19.0s | Then ffmpeg takes over. It composites the transparent HTML layers over the background, fits video and image clips, and mixes narration, music, and fades. One pass produces H.264 MP4 or VP9 WebM. |
| 5 | build | 1:16 | 14.5s | Building a video is a few commands. Init a project, add your scenes, add a music bed, and render. The project stays readable JSON, so the next edit is a command, not a binary file. |
| 6 | edit | 1:30 | 14.4s | Editing is just data. Trim a clip, split it at a timestamp, move it, change a property, or remove it. Every operation rewrites the timeline. Render again and the output follows. |
| 7 | media | 1:45 | 16.2s | Vigo also speaks ffmpeg. Convert formats, resize, trim, concatenate clips, extract frames, or pull a poster frame. Those outputs can go straight back into the timeline as media clips. |
| 8 | mcp | 2:01 | 22.4s | For agents, vigo runs as an MCP server. Fourteen tools cover project creation, scene writing, clip editing, rendering, probing, and conversion. The vigo guide resource carries the schema and the seek contract, so an agent can write, render, inspect, and iterate without a human in the loop. |
| 9 | architecture | 2:23 | 18.3s | The stack is deliberately small. TypeScript on Node, Chromium for painting, and ffmpeg for encoding. Three runtime dependencies, no database, no GPU, no editor state. Frames are staged in a temp folder and cleaned up. |
| 10 | outro | 2:42 | 9.3s | Install it, run vigo doctor, and make something. HTML in. Video out. Vigo: video, for agents. |

## Render

```bash
node dist/cli.js render examples/explainer/vigo.json -o renders/vigo-explainer.mp4
```

All HTML lives in `scenes/`. Narration is in `audio/`. The timeline is `vigo.json`.

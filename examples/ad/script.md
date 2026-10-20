# vigo ad — narration

Voice: `en-US-AndrewMultilingualNeural` (Edge neural TTS)
Total: 0:33 (33.21s)

| # | Scene | Start | Length | Narration |
| --- | --- | --- | --- | --- |
| 1 | hook | 0:00 | 6.4s | Video is the last thing an AI agent cannot make. Vigo changes that. |
| 2 | reveal | 0:06 | 5.0s | Write HTML. Describe your timeline in JSON. |
| 3 | pipeline | 0:11 | 5.7s | Vigo seeks every frame, paints it, and renders a real video. |
| 4 | edit | 0:17 | 5.4s | Trim it. Split it. Convert it. |
| 5 | mcp | 0:22 | 5.4s | Or hand the whole thing to an agent over MCP. |
| 6 | outro | 0:27 | 5.4s | Lightweight. Deterministic. Vigo. Video, for agents. |

## Render

```bash
node dist/cli.js render examples/ad/vigo.json -o renders/vigo-ad.mp4
```

All HTML lives in `scenes/`. Narration is in `audio/`. The timeline is `vigo.json`.

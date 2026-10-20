/**
 * Scenes for the vigo ad and the narrated explainer.
 *
 * Shared design system: dark technical stage, blue/violet accents, mono labels,
 * a chapter rail, and a progress bar driven by window.vigo.seek(t).
 */

const CSS = String.raw`
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #05070d; color: #f4f7ff; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
.stage { position: relative; width: 100%; height: 100%; padding: 8.5vh 7vw 9vh; overflow: hidden; }
.bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.grid {
  position: absolute; inset: -1px;
  background-image: linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px);
  background-size: 4.4vw 4.4vw;
  mask-image: radial-gradient(ellipse at 50% 45%, #000 20%, transparent 78%);
}
.glow { position: absolute; border-radius: 50%; opacity: .6; }
.g1 { width: 58vw; height: 58vw; left: -18vw; top: -24vw; background: radial-gradient(circle, rgba(79,140,255,.38), rgba(79,140,255,.12) 38%, transparent 70%); }
.g2 { width: 54vw; height: 54vw; right: -20vw; bottom: -26vw; background: radial-gradient(circle, rgba(139,92,246,.32), rgba(139,92,246,.1) 40%, transparent 72%); }
.vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, transparent 40%, rgba(3,5,10,.68) 100%); }
.cut { position: absolute; inset: 0; background: #05070d; z-index: 20; pointer-events: none; animation: cut .38s ease-out both; }
@keyframes cut { from { opacity: 1; } to { opacity: 0; } }
.top {
  position: absolute; top: 5.4vh; left: 7vw; right: 7vw; z-index: 3;
  display: flex; align-items: center; justify-content: space-between;
  font: 500 .68vw/1 "Fira Code", ui-monospace, monospace; letter-spacing: .2em; text-transform: uppercase; color: #71809d;
}
.brand { display: flex; align-items: center; gap: .6vw; color: #dce8ff; }
.mark { width: 1.35vw; height: 1.35vw; border-radius: .32vw; background: linear-gradient(135deg, #6ea0ff, #a78bfa); box-shadow: 0 0 1.2vw rgba(110,160,255,.55); }
.chapter { text-align: right; }
.content { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; justify-content: center; }
.eyebrow { font: 500 .72vw/1.4 "Fira Code", ui-monospace, monospace; letter-spacing: .26em; text-transform: uppercase; color: #8fb4ff; margin-bottom: 1.5vw; }
h1 { margin: 0 0 1.5vw; font-size: 5.2vw; line-height: .95; letter-spacing: -.045em; font-weight: 700; max-width: 88%; }
h1.small { font-size: 4.1vw; }
h1 em, h2 em { font-style: normal; background: linear-gradient(120deg, #8fb4ff, #c4b5fd); -webkit-background-clip: text; background-clip: text; color: transparent; }
h2 { margin: 0 0 1vw; font-size: 2.2vw; letter-spacing: -.03em; }
p { margin: 0; font-size: 1.32vw; line-height: 1.55; color: #a7b3ca; max-width: 54vw; }
p.wide { max-width: 64vw; }
.mono { font-family: "Fira Code", ui-monospace, monospace; }
.kicker { color: #71809d; letter-spacing: .18em; text-transform: uppercase; }
.chips { display: flex; flex-wrap: wrap; gap: .55vw; margin-top: 2vw; }
.chip {
  border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.035); border-radius: 999px;
  padding: .52vw .85vw; font: 500 .68vw/1 "Fira Code", ui-monospace, monospace; color: #bccdf0; white-space: nowrap;
}
.chip.hot { border-color: rgba(110,160,255,.45); color: #cfe0ff; background: rgba(110,160,255,.1); }
.card {
  border: 1px solid rgba(255,255,255,.11); background: linear-gradient(180deg, rgba(17,25,44,.9), rgba(7,11,22,.94));
  border-radius: .9vw; box-shadow: 0 1.8vw 5vw rgba(0,0,0,.42); position: relative; overflow: hidden;
}
.card:before { content: ""; position: absolute; inset: 0 0 auto; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent); }
.card-pad { padding: 1.5vw; }
.mono-card { font-family: "Fira Code", ui-monospace, monospace; font-size: .75vw; line-height: 1.72; color: #b9c8e6; }
.mono-card .k { color: #8fb4ff; }
.mono-card .s { color: #c4b5fd; }
.mono-card .c { color: #5f6f8e; }
.mono-card .n { color: #4ade80; }
.split { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr); gap: 4.5vw; align-items: center; height: 100%; }
.stack { display: flex; flex-direction: column; gap: 1vw; }
.row { display: flex; align-items: center; gap: 1vw; }
.grow { flex: 1; }
.muted { color: #7f8daa; }
.small { font-size: .95vw; line-height: 1.5; }
.tiny { font-size: .72vw; }
.footer {
  position: absolute; left: 7vw; bottom: 6.4vh; z-index: 3;
  font: 500 .64vw/1 "Fira Code", ui-monospace, monospace; letter-spacing: .18em; text-transform: uppercase; color: #5d6b87;
}
.progress { position: absolute; left: 7vw; right: 7vw; bottom: 4.1vh; height: 2px; background: rgba(255,255,255,.08); border-radius: 99px; overflow: hidden; z-index: 3; }
.progress i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #6ea0ff, #a78bfa); }
.reveal { animation: rise .9s cubic-bezier(.16,1,.3,1) both; }
.d1 { animation-delay: .12s; } .d2 { animation-delay: .25s; } .d3 { animation-delay: .38s; } .d4 { animation-delay: .52s; } .d5 { animation-delay: .66s; }
@keyframes rise { from { opacity: 0; transform: translateY(1.8vw); } to { opacity: 1; transform: none; } }
.fade { animation: fade .8s ease-out both; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.pop { animation: pop .8s cubic-bezier(.16,1,.3,1) both; }
@keyframes pop { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }

/* hero art */
.hero-art { width: 100%; max-width: 30vw; justify-self: end; }
.art-frame {
  aspect-ratio: 16 / 9; border: 1px solid rgba(255,255,255,.14); border-radius: 1vw; position: relative; overflow: hidden;
  background: radial-gradient(circle at 30% 30%, rgba(110,160,255,.35), transparent 60%), linear-gradient(135deg, #0b1224, #161129);
  box-shadow: 0 2vw 5vw rgba(0,0,0,.45); display: grid; place-items: center;
}
.art-frame .plate { position: absolute; inset: 10%; border: 1px solid rgba(255,255,255,.08); border-radius: .6vw; background: rgba(5,8,16,.45); }
.art-frame .scan { position: absolute; left: 0; right: 0; height: 14%; background: linear-gradient(180deg, transparent, rgba(110,160,255,.22), transparent); animation: scan 3.4s linear infinite; }
.art-frame .play {
  position: relative; z-index: 2; width: 4.4vw; height: 4.4vw; border-radius: 50%; border: 1px solid rgba(255,255,255,.3);
  display: grid; place-items: center; font-size: 1.3vw; background: rgba(8,14,28,.62); box-shadow: 0 0 2vw rgba(110,160,255,.25);
}
.art-frame .code { position: absolute; left: 1.2vw; bottom: 1vw; font: .62vw/1.6 "Fira Code", monospace; color: #9fb3d9; }
.art-meta { margin-top: .9vw; display: flex; justify-content: space-between; font: .6vw/1 "Fira Code", monospace; letter-spacing: .14em; text-transform: uppercase; color: #6f7f9c; }
@keyframes scan { from { top: -16%; } to { top: 104%; } }
.art-frame.deny .play { border-color: rgba(255,110,130,.4); }
.art-frame.deny:after { content: ""; position: absolute; width: 130%; height: 1px; background: #ff6e82; opacity: .7; transform: rotate(-24deg); }

/* code window */
.code-head { display: flex; align-items: center; gap: .4vw; padding: .65vw .9vw; border-bottom: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.025); }
.code-head i { width: .48vw; height: .48vw; border-radius: 50%; background: #3a4660; }
.code-head span { margin-left: .5vw; font: .6vw "Fira Code", monospace; color: #61708d; letter-spacing: .1em; }
.code-body { padding: 1.1vw 1.2vw; white-space: pre; overflow: hidden; }

/* layer stack */
.layers { display: flex; flex-direction: column; gap: .55vw; }
.layer {
  display: grid; grid-template-columns: 5vw 1fr 6vw; align-items: center; gap: .8vw;
  padding: .52vw .8vw; border: 1px solid rgba(255,255,255,.08); border-radius: .45vw;
  background: rgba(255,255,255,.025); font: .58vw "Fira Code", monospace; color: #9fb0d0;
}
.layer i { display: block; height: .5vw; border-radius: 99px; background: linear-gradient(90deg, #6ea0ff, #a78bfa); }
.layer em { font-style: normal; text-align: right; color: #64738f; font-size: .5vw; letter-spacing: .12em; text-transform: uppercase; }

/* flow */
.flow { display: flex; align-items: stretch; gap: .8vw; margin-top: 2.2vw; }
.flow-card { flex: 1; padding: .95vw 1vw; border: 1px solid rgba(255,255,255,.1); border-radius: .7vw; background: rgba(255,255,255,.025); font: .62vw/1.5 "Fira Code", monospace; color: #a9b8d6; }
.flow-card b { display: block; font: 600 .92vw/1.2 ui-sans-serif, sans-serif; color: #f4f7ff; margin-bottom: .35vw; letter-spacing: -.01em; }
.flow-card.hot { border-color: rgba(110,160,255,.48); background: rgba(110,160,255,.1); }
.flow-arrow { display: grid; place-items: center; color: #5f6f8e; font-size: 1.15vw; }
.filmstrip { position: relative; display: flex; gap: .3vw; margin-top: 1.4vw; padding: .45vw; border: 1px solid rgba(255,255,255,.1); border-radius: .55vw; background: rgba(255,255,255,.02); }
.frame { flex: 1; aspect-ratio: 16 / 9; border-radius: .28vw; background: linear-gradient(135deg, rgba(110,160,255,.22), rgba(167,139,250,.12)); border: 1px solid rgba(255,255,255,.06); position: relative; overflow: hidden; }
.frame:before { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.14), transparent); transform: translateX(-100%); animation: shine 2.6s linear infinite; }
.frame span { position: absolute; left: .35vw; bottom: .28vw; font: .46vw "Fira Code", monospace; color: #8fa1c0; }
@keyframes shine { to { transform: translateX(100%); } }
.playhead2 { position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: #8fb4ff; box-shadow: 0 0 .8vw #6ea0ff; }

/* terminal */
.terminal { padding: 0; }
.term-head { display: flex; align-items: center; gap: .4vw; padding: .6vw .9vw; border-bottom: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.025); }
.term-head i { width: .48vw; height: .48vw; border-radius: 50%; background: #3a4660; }
.term-head span { margin-left: .5vw; font: .58vw "Fira Code", monospace; color: #61708d; }
.terminal pre { margin: 0; padding: 1.1vw 1.2vw; font: .63vw/2.05 "Fira Code", monospace; color: #b9c8e6; white-space: pre; overflow: hidden; }
.terminal .pr { color: #6ea0ff; }
.terminal .dim { color: #61708d; }
.term-line { display: block; animation: fade .35s both; }
.term-line:nth-child(2) { animation-delay: .4s; } .term-line:nth-child(3) { animation-delay: .75s; } .term-line:nth-child(4) { animation-delay: 1.1s; } .term-line:nth-child(5) { animation-delay: 1.45s; }
.term-out { margin: 0 1.2vw 1.2vw; padding: .62vw .8vw; border: 1px solid rgba(74,222,128,.25); border-radius: .4vw; background: rgba(74,222,128,.07); font: .62vw "Fira Code", monospace; color: #a7f3d0; display: flex; justify-content: space-between; gap: 1vw; }
.term-out span { color: #5f9f86; }

/* timeline */
.timeline-card { padding: 1.1vw 1.3vw 1vw; margin-top: 1.9vw; }
.ruler { display: flex; justify-content: space-between; padding-left: 5.2vw; margin-bottom: .6vw; font: .54vw "Fira Code", monospace; color: #5f6f8e; }
.timeline-track { display: flex; align-items: center; gap: .7vw; margin-bottom: .55vw; }
.track-label { width: 4.5vw; font: .54vw "Fira Code", monospace; color: #71809d; text-transform: uppercase; letter-spacing: .14em; }
.track { position: relative; flex: 1; height: 3vw; border: 1px solid rgba(255,255,255,.07); border-radius: .35vw; background: rgba(255,255,255,.02); overflow: hidden; display: flex; }
.clip { position: relative; height: 100%; display: flex; align-items: center; padding: 0 .65vw; border-right: 1px solid rgba(5,7,13,.72); white-space: nowrap; overflow: hidden; font: .55vw "Fira Code", monospace; }
.clip.html { background: linear-gradient(180deg, rgba(110,160,255,.34), rgba(110,160,255,.12)); color: #dce8ff; }
.clip.media { background: linear-gradient(180deg, rgba(167,139,250,.3), rgba(167,139,250,.1)); color: #e6dcff; }
.clip.audio { background: linear-gradient(180deg, rgba(74,222,128,.22), rgba(74,222,128,.07)); color: #b8f5d2; }
.track .ph { position: absolute; top: -.35vw; bottom: -.35vw; left: 0; width: 1px; background: #fff; box-shadow: 0 0 .9vw rgba(255,255,255,.8); }
.edit-tags { display: flex; gap: .45vw; margin-top: .8vw; padding-left: 5.2vw; }
.edit-tags span { padding: .35vw .55vw; border: 1px solid rgba(255,255,255,.1); border-radius: .3vw; font: .5vw "Fira Code", monospace; color: #9fb0d0; }

/* formats */
.formats { display: grid; grid-template-columns: repeat(3, 1fr); gap: .8vw; margin-top: 1.9vw; max-width: 51vw; }
.format { padding: .9vw 1vw; border: 1px solid rgba(255,255,255,.1); border-radius: .55vw; background: rgba(255,255,255,.026); }
.format b { display: block; font: 600 1.25vw/1.1 ui-sans-serif, sans-serif; letter-spacing: -.02em; }
.format span { font: .54vw "Fira Code", monospace; color: #71809d; letter-spacing: .1em; text-transform: uppercase; }
.format.hot { border-color: rgba(110,160,255,.4); background: rgba(110,160,255,.08); }

/* mcp */
.mcp-diagram { display: flex; flex-direction: column; gap: .6vw; }
.mcp-node { padding: .9vw 1.1vw; border: 1px solid rgba(255,255,255,.11); border-radius: .6vw; background: rgba(255,255,255,.028); }
.mcp-node.agent { display: flex; justify-content: space-between; align-items: center; }
.mcp-node b { font: 600 1vw/1.2 ui-sans-serif, sans-serif; }
.mcp-node span { font: .55vw "Fira Code", monospace; color: #71809d; letter-spacing: .12em; text-transform: uppercase; }
.mcp-server { padding: 0; overflow: hidden; border-color: rgba(110,160,255,.35); }
.mcp-server .head { display: flex; justify-content: space-between; align-items: center; padding: .7vw 1vw; border-bottom: 1px solid rgba(255,255,255,.08); background: rgba(110,160,255,.06); font: .65vw "Fira Code", monospace; color: #cfe0ff; }
.mcp-server .head span { color: #71809d; font-size: .5vw; letter-spacing: .14em; text-transform: uppercase; }
.tool-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .3vw; padding: .8vw; }
.tool { padding: .28vw .4vw; border: 1px solid rgba(255,255,255,.07); border-radius: .22vw; font: .48vw "Fira Code", monospace; color: #aebfe0; background: rgba(255,255,255,.018); }
.mcp-connector { height: 1.4vw; position: relative; display: grid; place-items: center; font: .48vw "Fira Code", monospace; letter-spacing: .16em; text-transform: uppercase; color: #5f6f8e; }
.mcp-connector:before { content: ""; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: linear-gradient(#6ea0ff66, #a78bfa66); }
.guide-pill { display: flex; justify-content: space-between; align-items: center; padding: .65vw .9vw; border: 1px dashed rgba(167,139,250,.35); border-radius: .45vw; font: .55vw "Fira Code", monospace; color: #c4b5fd; background: rgba(167,139,250,.06); }
.guide-pill span { color: #71809d; font-size: .46vw; letter-spacing: .12em; text-transform: uppercase; }

/* architecture */
.arch { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1vw; margin-top: 1.8vw; }
.arch .card { padding: 1.3vw; }
.arch b { display: block; font: 600 1.05vw/1.2 ui-sans-serif, sans-serif; margin-bottom: .4vw; }
.arch span { font: .56vw "Fira Code", monospace; color: #8fa1c0; line-height: 1.6; display: block; }
.stats { display: flex; gap: 3vw; margin-top: 2vw; }
.stats b { display: block; font: 700 2.5vw/1 ui-sans-serif, sans-serif; letter-spacing: -.04em; }
.stats span { font: .55vw "Fira Code", monospace; color: #71809d; letter-spacing: .16em; text-transform: uppercase; }

/* end card */
.center { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.end-logo {
  font-size: 12.5vw; line-height: .82; letter-spacing: -.085em; font-weight: 700;
  background: linear-gradient(180deg, #ffffff, #8fb4ff 58%, #a78bfa);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: pop 1s cubic-bezier(.16,1,.3,1) both;
}
.end-tag { margin-top: 1vw; font-size: 1.9vw; letter-spacing: -.02em; color: #a7b3ca; animation: rise .9s cubic-bezier(.16,1,.3,1) .2s both; }
.end-cmds { margin-top: 2vw; padding: .9vw 1.3vw; border: 1px solid rgba(255,255,255,.12); border-radius: .55vw; background: rgba(255,255,255,.03); font: .75vw/1.9 "Fira Code", monospace; color: #cfe0ff; animation: fade .9s ease-out .45s both; }
.end-cmds span { color: #6f7f9c; }
.end-foot { margin-top: 1.8vw; font: .6vw "Fira Code", monospace; letter-spacing: .2em; text-transform: uppercase; color: #64738f; animation: fade .9s ease-out .7s both; }
`;

export function scenePage({ title, chapter, body, start, duration, total, seekCode = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
  <div class="stage">
    <div class="bg"><div class="glow g1"></div><div class="glow g2"></div><div class="grid"></div><div class="vignette"></div></div>
    <div class="top"><div class="brand"><span class="mark"></span>vigo</div><div class="chapter">${chapter}</div></div>
    ${body}
    <div class="footer">vigo / html in, video out</div>
    <div class="progress"><i id="bar"></i></div>
    <div class="cut"></div>
  </div>
  <script>
    const START = ${start};
    const TOTAL = ${total};
    const bar = document.getElementById("bar");
    window.vigo = {
      seek(t) {
        const global = START + t;
        bar.style.width = (Math.min(1, Math.max(0, global / TOTAL)) * 100).toFixed(3) + "%";
        ${seekCode}
      }
    };
  </script>
</body>
</html>`;
}

const terminal = (lines, output) => `
<div class="terminal card">
  <div class="term-head"><i></i><i></i><i></i><span>~/launch</span></div>
  <pre>${lines.map((line) => `<span class="term-line"><span class="pr">$</span> ${line}</span>`).join("\n")}</pre>
  <div class="term-out"><span>✓ ${output}</span><span>1280×720 · 30fps</span></div>
</div>`;

export const AD_SECTIONS = [
  {
    id: "hook",
    chapter: "ad / 01 — the gap",
    title: "The gap",
    minDuration: 5.2,
    voice:
      "Video is the last thing an AI agent cannot make. Vigo changes that.",
    body: () => `
      <div class="split">
        <div>
          <div class="eyebrow reveal">the last output</div>
          <h1 class="reveal d1">Agents can ship code.<br /><em>Not video.</em></h1>
          <p class="reveal d2">A real renderer for the agent era. HTML scenes in. Editable video out.</p>
          <div class="chips reveal d3"><span class="chip">code ✓</span><span class="chip">docs ✓</span><span class="chip hot">video ?</span></div>
        </div>
        <div class="hero-art reveal d2">
          <div class="art-frame deny">
            <div class="plate"></div><div class="scan"></div>
            <div class="play">▶</div>
            <div class="code">&lt;video /&gt;</div>
          </div>
          <div class="art-meta"><span>missing output</span><span>error 404</span></div>
        </div>
      </div>`,
  },
  {
    id: "reveal",
    chapter: "ad / 02 — the reveal",
    title: "vigo",
    minDuration: 3.4,
    voice: "Write HTML. Describe your timeline in JSON.",
    body: () => `
      <div class="center">
        <div class="end-logo">vigo</div>
        <div class="end-tag">video, for agents.</div>
        <div class="end-foot">html scenes · json timeline · mcp</div>
      </div>`,
  },
  {
    id: "pipeline",
    chapter: "ad / 03 — the engine",
    title: "HTML to video",
    minDuration: 5.6,
    voice: "Vigo seeks every frame, paints it, and renders a real video.",
    body: () => `
      <div class="split">
        <div>
          <div class="eyebrow reveal">deterministic by design</div>
          <h1 class="reveal d1">Write HTML.<br /><em>Render reality.</em></h1>
          <p class="reveal d2">CSS is paused and seeked. Frames are captured. ffmpeg does the rest.</p>
        </div>
        <div class="stack reveal d2">
          <div class="card code-window">
            <div class="code-head"><i></i><i></i><i></i><span>intro.html</span></div>
            <div class="code-body mono-card"><span class="c">&lt;style&gt;</span>
  <span class="k">h1</span> { <span class="k">animation</span>: rise <span class="n">1s</span> both; }
<span class="c">&lt;/style&gt;</span>
<span class="c">&lt;h1&gt;</span>Hello<span class="c">&lt;/h1&gt;</span></div>
          </div>
          <div class="flow">
            <div class="flow-card"><b>HTML</b>scene</div>
            <div class="flow-arrow">→</div>
            <div class="flow-card hot"><b>Frame</b>seek(t)</div>
            <div class="flow-arrow">→</div>
            <div class="flow-card"><b>MP4</b>h.264</div>
          </div>
        </div>
      </div>`,
  },
  {
    id: "edit",
    chapter: "ad / 04 — the edit",
    title: "Edit video like JSON",
    minDuration: 5.4,
    voice: "Trim it. Split it. Convert it.",
    body: () => `
      <div class="content">
        <div class="eyebrow reveal">the project stays editable</div>
        <h1 class="small reveal d1">Edit video<br /><em>like JSON.</em></h1>
        <div class="timeline-card card reveal d2">
          <div class="ruler"><span>00:00</span><span>00:04</span><span>00:08</span><span>00:12</span></div>
          <div class="timeline-track">
            <div class="track-label">main</div>
            <div class="track">
              <div class="clip html" style="width:33.3%">intro · 4s</div>
              <div class="clip html" style="width:33.3%">body · 4s</div>
              <div class="clip html" style="width:33.3%">outro · 4s</div>
              <div class="ph" id="ph"></div>
            </div>
          </div>
          <div class="timeline-track">
            <div class="track-label">audio</div>
            <div class="track"><div class="clip audio" style="width:100%">music · volume .7 · fadeOut 2s</div></div>
          </div>
          <div class="edit-tags"><span>trim</span><span>split</span><span>move</span><span>set</span><span>convert</span></div>
        </div>
        <div class="chips reveal d3"><span class="chip">vigo trim</span><span class="chip">vigo split</span><span class="chip">vigo convert</span></div>
      </div>`,
    seekCode: `const ph = document.getElementById("ph"); if (ph) ph.style.left = (Math.min(1, t / 10) * 100).toFixed(3) + "%";`,
  },
  {
    id: "mcp",
    chapter: "ad / 05 — mcp",
    title: "Give agents the controls",
    minDuration: 5.4,
    voice: "Or hand the whole thing to an agent over MCP.",
    body: () => `
      <div class="split">
        <div>
          <div class="eyebrow reveal">agent native</div>
          <h1 class="reveal d1">Give agents<br /><em>the controls.</em></h1>
          <p class="reveal d2">Fourteen tools. One guide resource. A full create → render → inspect loop.</p>
          <div class="chips reveal d3"><span class="chip hot">vigo mcp</span><span class="chip">stdio</span><span class="chip">vigo://guide</span></div>
        </div>
        <div class="mcp-diagram reveal d2">
          <div class="mcp-node agent"><b>agent</b><span>write · render · probe</span></div>
          <div class="mcp-connector">stdio</div>
          <div class="mcp-node mcp-server">
            <div class="head">vigo mcp <span>14 tools</span></div>
            <div class="tool-grid">
              <div class="tool">create_project</div><div class="tool">write_scene</div>
              <div class="tool">add_clip</div><div class="tool">edit</div>
              <div class="tool">render</div><div class="tool">html_to_video</div>
              <div class="tool">convert</div><div class="tool">probe</div>
              <div class="tool">thumbnail</div><div class="tool">extract_frames</div>
              <div class="tool">concat</div><div class="tool">doctor</div>
            </div>
          </div>
          <div class="guide-pill">vigo://guide <span>schema + seek contract</span></div>
        </div>
      </div>`,
  },
  {
    id: "outro",
    chapter: "ad / 06 — end card",
    title: "Vigo — video, for agents",
    minDuration: 4.2,
    voice: "Lightweight. Deterministic. Vigo. Video, for agents.",
    body: () => `
      <div class="center">
        <div class="end-logo">vigo</div>
        <div class="end-tag">HTML in. Video out.</div>
        <div class="end-cmds"><span>$</span> vigo html2video scene.html -o out.mp4<br /><span>$</span> vigo mcp</div>
        <div class="end-foot">lightweight · deterministic · editable · mcp</div>
      </div>`,
  },
];

export const EXPLAINER_SECTIONS = [
  {
    id: "gap",
    chapter: "01 / the gap",
    title: "The gap",
    minDuration: 9,
    voice:
      "AI agents can write code, docs, and entire apps. Video was the missing output. Vigo closes that gap: a lightweight engine that turns HTML scenes and a JSON timeline into a real, editable video.",
    body: () => `
      <div class="split">
        <div>
          <div class="eyebrow reveal">vigo / how it works</div>
          <h1 class="reveal d1">Agents can write<br />your code.<br /><em>Video was the gap.</em></h1>
          <p class="reveal d2">HTML scenes and a JSON timeline in. A real, editable video out. Deterministically.</p>
          <div class="chips reveal d3"><span class="chip">html → frames</span><span class="chip">json timeline</span><span class="chip">ffmpeg</span><span class="chip hot">mcp</span></div>
        </div>
        <div class="hero-art reveal d2">
          <div class="art-frame">
            <div class="plate"></div><div class="scan"></div><div class="play">▶</div>
            <div class="code">frame 0142<br />00:04.73</div>
          </div>
          <div class="art-meta"><span>scene.html</span><span>out.mp4</span></div>
        </div>
      </div>`,
  },
  {
    id: "model",
    chapter: "02 / the model",
    title: "A video is a JSON timeline",
    minDuration: 10,
    voice:
      "The mental model is simple. A video is a JSON timeline. Visual tracks stack in order. Each clip has a start, a duration, and an offset. HTML clips are scenes. Media clips are footage. Audio tracks are mixed underneath.",
    body: () => `
      <div class="split">
        <div>
          <div class="eyebrow reveal">one file, no editor state</div>
          <h1 class="small reveal d1">A video is a<br /><em>JSON timeline.</em></h1>
          <p class="reveal d2">Tracks stack. Clips carry start, duration, and offset. HTML layers sit above media; audio mixes underneath.</p>
          <div class="chips reveal d3"><span class="chip">tracks</span><span class="chip">clips</span><span class="chip">offset</span><span class="chip">layers</span></div>
        </div>
        <div class="stack reveal d2">
          <div class="card code-window">
            <div class="code-head"><i></i><i></i><i></i><span>vigo.json</span></div>
            <div class="code-body mono-card">{
  <span class="k">"version"</span>: <span class="n">1</span>,
  <span class="k">"width"</span>: <span class="n">1280</span>, <span class="k">"height"</span>: <span class="n">720</span>,
  <span class="k">"fps"</span>: <span class="n">24</span>,
  <span class="k">"tracks"</span>: [
    { <span class="k">"type"</span>: <span class="s">"html"</span>,  <span class="k">"clips"</span>: [ ... ] },
    { <span class="k">"type"</span>: <span class="s">"media"</span>, <span class="k">"clips"</span>: [ ... ] },
    { <span class="k">"type"</span>: <span class="s">"audio"</span>, <span class="k">"clips"</span>: [ ... ] }
  ]
}</div>
          </div>
          <div class="layers">
            <div class="layer"><span>html</span><i style="width:74%"></i><em>scenes</em></div>
            <div class="layer"><span>media</span><i style="width:46%"></i><em>footage</em></div>
            <div class="layer"><span>audio</span><i style="width:92%"></i><em>mix</em></div>
          </div>
        </div>
      </div>`,
  },
  {
    id: "determinism",
    chapter: "03 / deterministic frames",
    title: "Time is a function",
    minDuration: 13,
    voice:
      "Rendering is deterministic. Vigo opens each scene in headless Chromium and freezes time. It pauses and seeks every CSS and Web Animation, seeks video elements, then calls your optional vigo dot seek hook. Every frame is captured at an exact timestamp, so repeated renders match.",
    body: () => `
      <div class="content">
        <div class="eyebrow reveal">pause. seek. capture. repeat.</div>
        <h1 class="small reveal d1">Time is a <em>function.</em></h1>
        <div class="flow reveal d2">
          <div class="flow-card"><b>Chromium</b>open scene</div>
          <div class="flow-arrow">→</div>
          <div class="flow-card hot"><b>seek(t)</b>css · waapi · video</div>
          <div class="flow-arrow">→</div>
          <div class="flow-card"><b>PNG</b>exact frame</div>
          <div class="flow-arrow">→</div>
          <div class="flow-card"><b>ffmpeg</b>encode</div>
        </div>
        <div class="filmstrip reveal d3">
          <div class="frame"><span>00:00</span></div><div class="frame"><span>00:01</span></div>
          <div class="frame"><span>00:02</span></div><div class="frame"><span>00:03</span></div>
          <div class="frame"><span>00:04</span></div><div class="frame"><span>00:05</span></div>
          <div class="frame"><span>00:06</span></div><div class="frame"><span>00:07</span></div>
          <div class="playhead2" id="film-ph"></div>
        </div>
        <div class="chips reveal d4"><span class="chip">CSS keyframes</span><span class="chip">Web Animations</span><span class="chip">video currentTime</span><span class="chip hot">window.vigo.seek(t)</span></div>
      </div>`,
    seekCode: `const fph = document.getElementById("film-ph"); if (fph) fph.style.left = (Math.min(1, (t % 8) / 8) * 100).toFixed(3) + "%";`,
  },
  {
    id: "composite",
    chapter: "04 / composite",
    title: "Layers in, one file out",
    minDuration: 11,
    voice:
      "Then ffmpeg takes over. It composites the transparent HTML layers over the background, fits video and image clips, and mixes narration, music, and fades. One pass produces H.264 MP4 or VP9 WebM.",
    body: () => `
      <div class="split">
        <div>
          <div class="eyebrow reveal">composite · mix · encode</div>
          <h1 class="small reveal d1">Layers in.<br /><em>One file out.</em></h1>
          <p class="reveal d2">Transparent HTML frames stack over the background. Media fits into frame. Audio is trimmed, faded, and mixed.</p>
          <div class="chips reveal d3"><span class="chip">H.264 / AAC</span><span class="chip">VP9 / Opus</span><span class="chip">contain · cover · fill</span></div>
        </div>
        <div class="stack reveal d2">
          <div class="layers">
            <div class="layer"><span>html</span><i style="width:82%"></i><em>rgba</em></div>
            <div class="layer"><span>video</span><i style="width:57%"></i><em>fit</em></div>
            <div class="layer"><span>audio</span><i style="width:94%"></i><em>mix</em></div>
          </div>
          <div class="flow-arrow" style="font-size:1.4vw">↓</div>
          <div class="card card-pad">
            <div class="row"><b class="mono" style="font-size:1vw">ffmpeg</b><span class="tiny muted">filter graph</span></div>
            <div class="flow" style="margin-top:.7vw">
              <div class="flow-card" style="flex:1"><b>background</b>color</div>
              <div class="flow-arrow">+</div>
              <div class="flow-card" style="flex:1"><b>layers</b>png</div>
              <div class="flow-arrow">+</div>
              <div class="flow-card" style="flex:1"><b>audio</b>tracks</div>
            </div>
          </div>
          <div class="term-out" style="margin:0"><span>✓ output.mp4</span><span>H.264 · AAC · 24fps</span></div>
        </div>
      </div>`,
  },
  {
    id: "build",
    chapter: "05 / build",
    title: "Four commands",
    minDuration: 12,
    voice:
      "Building a video is a few commands. Init a project, add your scenes, add a music bed, and render. The project stays readable JSON, so the next edit is a command, not a binary file.",
    body: () => `
      <div class="split">
        <div>
          <div class="eyebrow reveal">the happy path</div>
          <h1 class="small reveal d1">Four<br /><em>commands.</em></h1>
          <p class="reveal d2">No timeline UI. No project database. The JSON file is the source of truth.</p>
          <div class="chips reveal d3"><span class="chip">init</span><span class="chip">add</span><span class="chip">render</span><span class="chip">inspect</span></div>
        </div>
        <div class="reveal d2">
          ${terminal(
            [
              "vigo init launch --duration 8",
              "vigo add launch/vigo.json --src intro.html --duration 4",
              "vigo add launch/vigo.json --src music.mp3 --volume .7",
              "vigo render launch/vigo.json -o out/launch.mp4",
            ],
            "out/launch.mp4",
          )}
        </div>
      </div>`,
  },
  {
    id: "edit",
    chapter: "06 / edit",
    title: "The timeline is the edit",
    minDuration: 10,
    voice:
      "Editing is just data. Trim a clip, split it at a timestamp, move it, change a property, or remove it. Every operation rewrites the timeline. Render again and the output follows.",
    body: () => `
      <div class="content">
        <div class="eyebrow reveal">json is the source of truth</div>
        <h1 class="small reveal d1">The timeline <em>is the edit.</em></h1>
        <p class="reveal d2" style="max-width:58vw">Trim, split, move, set, remove. Every command is an idempotent edit to the same file.</p>
        <div class="timeline-card card reveal d3">
          <div class="ruler"><span>00:00</span><span>00:03</span><span>00:06</span><span>00:09</span><span>00:12</span></div>
          <div class="timeline-track">
            <div class="track-label">main</div>
            <div class="track">
              <div class="clip html" style="width:33%">intro · 4s</div>
              <div class="clip html" style="width:33%">body · 4s</div>
              <div class="clip html" style="width:33%">outro · 4s</div>
              <div class="ph" id="edit-ph"></div>
            </div>
          </div>
          <div class="timeline-track">
            <div class="track-label">audio</div>
            <div class="track"><div class="clip audio" style="width:100%">music · -18 dB under voice · fadeOut 2s</div></div>
          </div>
          <div class="edit-tags"><span>vigo trim</span><span>vigo split --at</span><span>vigo move --to</span><span>vigo set</span><span>vigo rm</span></div>
        </div>
        <div class="chips reveal d4"><span class="chip">render again</span><span class="chip hot">same JSON</span></div>
      </div>`,
    seekCode: `const eph = document.getElementById("edit-ph"); if (eph) eph.style.left = (Math.min(1, t / 11) * 100).toFixed(3) + "%";`,
  },
  {
    id: "media",
    chapter: "07 / conversions",
    title: "And it speaks ffmpeg",
    minDuration: 9,
    voice:
      "Vigo also speaks ffmpeg. Convert formats, resize, trim, concatenate clips, extract frames, or pull a poster frame. Those outputs can go straight back into the timeline as media clips.",
    body: () => `
      <div class="split">
        <div>
          <div class="eyebrow reveal">one media layer, many formats</div>
          <h1 class="small reveal d1">And it speaks<br /><em>ffmpeg.</em></h1>
          <p class="reveal d2">Convert, concat, probe, extract, and thumbnail. Then feed the result back in as a media clip.</p>
          <div class="chips reveal d3"><span class="chip">convert</span><span class="chip">concat</span><span class="chip">thumb</span><span class="chip">frames</span><span class="chip">probe</span></div>
        </div>
        <div class="formats reveal d2">
          <div class="format hot"><b>MP4</b><span>h.264 / aac</span></div>
          <div class="format"><b>WebM</b><span>vp9 / opus</span></div>
          <div class="format"><b>GIF</b><span>palette</span></div>
          <div class="format"><b>MP3</b><span>audio</span></div>
          <div class="format"><b>PNG</b><span>frames</span></div>
          <div class="format"><b>JPG</b><span>poster</span></div>
          <div class="format" style="grid-column:span 3;border-style:dashed;background:transparent;text-align:center"><span style="color:#8fb4ff">↺ back into the timeline</span></div>
        </div>
      </div>`,
  },
  {
    id: "mcp",
    chapter: "08 / mcp",
    title: "An agent loop, not a GUI",
    minDuration: 12,
    voice:
      "For agents, vigo runs as an MCP server. Fourteen tools cover project creation, scene writing, clip editing, rendering, probing, and conversion. The vigo guide resource carries the schema and the seek contract, so an agent can write, render, inspect, and iterate without a human in the loop.",
    body: () => `
      <div class="split">
        <div>
          <div class="eyebrow reveal">stdio + json tools</div>
          <h1 class="small reveal d1">An agent loop,<br /><em>not a GUI.</em></h1>
          <p class="reveal d2">Create a project, write scenes, add clips, edit, render, probe. One guide resource keeps the contract close.</p>
          <div class="chips reveal d3"><span class="chip hot">vigo mcp</span><span class="chip">14 tools</span><span class="chip">vigo://guide</span></div>
        </div>
        <div class="mcp-diagram reveal d2">
          <div class="mcp-node agent"><b>agent</b><span>write · render · inspect</span></div>
          <div class="mcp-connector">stdio</div>
          <div class="mcp-node mcp-server">
            <div class="head">vigo mcp <span>tools</span></div>
            <div class="tool-grid">
              <div class="tool">create_project</div><div class="tool">get_project</div>
              <div class="tool">write_scene</div><div class="tool">add_clip</div>
              <div class="tool">edit</div><div class="tool">render</div>
              <div class="tool">html_to_video</div><div class="tool">convert</div>
              <div class="tool">probe</div><div class="tool">thumbnail</div>
              <div class="tool">extract_frames</div><div class="tool">concat</div>
            </div>
          </div>
          <div class="guide-pill">vigo://guide <span>schema + seek contract</span></div>
        </div>
      </div>`,
  },
  {
    id: "architecture",
    chapter: "09 / architecture",
    title: "Small on purpose",
    minDuration: 10,
    voice:
      "The stack is deliberately small. TypeScript on Node, Chromium for painting, and ffmpeg for encoding. Three runtime dependencies, no database, no GPU, no editor state. Frames are staged in a temp folder and cleaned up.",
    body: () => `
      <div class="content">
        <div class="eyebrow reveal">lightweight by construction</div>
        <h1 class="small reveal d1">Small <em>on purpose.</em></h1>
        <div class="arch reveal d2">
          <div class="card"><b>Node + TypeScript</b><span>cli · library · mcp<br />no compile step at runtime</span></div>
          <div class="card"><b>Chromium</b><span>paints html frames<br />deterministic seek</span></div>
          <div class="card"><b>ffmpeg</b><span>composite · mix · encode<br />system binary</span></div>
        </div>
        <div class="stats reveal d3">
          <div><b>3</b><span>runtime deps</span></div>
          <div><b>0</b><span>databases</span></div>
          <div><b>1</b><span>json project</span></div>
          <div><b>~70KB</b><span>packed, without deps</span></div>
        </div>
        <p class="reveal d4" style="margin-top:1.8vw;max-width:64vw">PNG frames are staged in a temp directory, composited once, and deleted. No GPU, no editor state, no hidden binary project.</p>
      </div>`,
  },
  {
    id: "outro",
    chapter: "10 / start",
    title: "HTML in, video out",
    minDuration: 7,
    voice:
      "Install it, run vigo doctor, and make something. HTML in. Video out. Vigo: video, for agents.",
    body: () => `
      <div class="center">
        <div class="end-logo">vigo</div>
        <div class="end-tag">Video, for agents.</div>
        <div class="end-cmds"><span>$</span> vigo doctor<br /><span>$</span> vigo html2video scene.html -o out.mp4<br /><span>$</span> vigo mcp</div>
        <div class="end-foot">lightweight · deterministic · editable · mcp</div>
      </div>`,
  },
];

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { htmlToVideo, probeMedia, renderComposition } from "../dist/index.js";
import { runProcess } from "../dist/media/ffmpeg.js";

const HTML = `<!doctype html><html><head><style>
  html,body{margin:0;height:100%;overflow:hidden;background:#101820;color:#fff;font-family:sans-serif}
  .stage{height:100%;display:grid;place-items:center}
  h1{font-size:56px;animation:rise .8s ease-out both}
  @keyframes rise{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
</style></head><body><div class="stage"><h1>vigo test</h1></div></body></html>`;

test("htmlToVideo renders a deterministic HTML scene", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vigo-render-"));
  try {
    const output = path.join(dir, "html.mp4");
    const result = await htmlToVideo({
      html: HTML,
      output,
      duration: 1,
      width: 160,
      height: 90,
      fps: 8,
    });
    assert.equal(result.width, 160);
    assert.equal(result.height, 90);
    assert.equal(result.fps, 8);
    assert.equal(result.frames, 8);
    assert.ok((await stat(output)).size > 1000);

    const info = await probeMedia(output);
    assert.equal(info.video.codec, "h264");
    assert.equal(info.video.width, 160);
    assert.equal(info.video.height, 90);
    assert.ok(Math.abs(info.duration - 1) < 0.1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("composition layers HTML, video, and audio", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vigo-render-"));
  try {
    const media = path.join(dir, "media.mp4");
    const tone = path.join(dir, "tone.m4a");
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=s=320x180:d=1:r=8",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", media,
    ]);
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=330:duration=1",
      "-c:a", "aac", tone,
    ]);

    const output = path.join(dir, "layers.mp4");
    const result = await renderComposition(
      {
        version: 1,
        name: "layers",
        width: 240,
        height: 136,
        fps: 8,
        duration: 1,
        background: "#103050",
        tracks: [
          {
            id: "main",
            type: "html",
            clips: [{ id: "scene", kind: "html", start: 0, duration: 1, html: HTML }],
          },
          {
            id: "media",
            type: "media",
            clips: [{ id: "clip", kind: "video", src: media, start: 0.2, duration: 0.4, offset: 0.1, fit: "cover" }],
          },
          {
            id: "audio",
            type: "audio",
            clips: [{ id: "bed", kind: "audio", src: tone, start: 0, duration: 1, volume: 0.4, fadeOut: 0.2 }],
          },
        ],
      },
      { output },
    );

    assert.equal(result.htmlLayers, 1);
    assert.equal(result.mediaClips, 1);
    assert.equal(result.audioClips, 1);
    const info = await probeMedia(output);
    assert.equal(info.video.width, 240);
    assert.ok(info.audio, "expected an audio stream");
    assert.ok(Math.abs(info.duration - 1) < 0.15);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("jpeg frame capture works for a single opaque layer", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vigo-render-"));
  try {
    const output = path.join(dir, "fast.mp4");
    const result = await htmlToVideo({
      html: HTML,
      output,
      duration: 0.5,
      width: 160,
      height: 90,
      fps: 8,
      frameFormat: "jpeg",
    });
    assert.equal(result.frameFormat, "jpeg");
    const info = await probeMedia(output);
    assert.equal(info.video.width, 160);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("webm rendering uses VP9", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vigo-render-"));
  try {
    const output = path.join(dir, "html.webm");
    await htmlToVideo({ html: HTML, output, duration: 0.5, width: 160, height: 90, fps: 8 });
    const info = await probeMedia(output);
    assert.equal(info.video.codec, "vp9");
    assert.equal(info.video.width, 160);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("odd frame sizes are rejected with a clear error", { timeout: 30_000 }, async () => {
  await assert.rejects(
    () =>
      htmlToVideo({
        html: HTML,
        output: path.join(os.tmpdir(), "vigo-odd.mp4"),
        duration: 1,
        width: 161,
        height: 90,
        fps: 8,
      }),
    /even/,
  );
});

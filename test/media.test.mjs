import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { concatMedia, convertMedia, extractFrames, probeMedia, thumbnail } from "../dist/index.js";
import { runProcess } from "../dist/media/ffmpeg.js";

async function makeClip(file, size, seconds, withAudio) {
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=s=${size}:d=${seconds}:r=10`,
  ];
  if (withAudio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (withAudio) args.push("-c:a", "aac", "-shortest");
  args.push(file);
  await runProcess("ffmpeg", args);
}

test("convert, thumbnail, frames, concat", { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vigo-media-"));
  try {
    const a = path.join(dir, "a.mp4");
    const b = path.join(dir, "b.mp4");
    await makeClip(a, "320x180", 1, true);
    await makeClip(b, "240x136", 1, false);

    const webm = await convertMedia(a, { output: path.join(dir, "a.webm"), width: 240 });
    assert.equal(webm.width, 240);
    const webmInfo = await probeMedia(webm.output);
    assert.equal(webmInfo.video.codec, "vp9");
    assert.equal(webmInfo.audio.codec, "opus");

    const gif = await convertMedia(a, { output: path.join(dir, "a.gif"), fps: 6, width: 160 });
    assert.ok((await stat(gif.output)).size > 500);

    const mp3 = await convertMedia(a, { output: path.join(dir, "a.mp3"), duration: 0.5 });
    assert.ok((await stat(mp3.output)).size > 100);

    const poster = await thumbnail(a, { output: path.join(dir, "poster.png"), at: 0.5, width: 160 });
    assert.equal(poster.width, 160);
    assert.ok((await stat(poster.output)).size > 100);

    const frames = await extractFrames(a, { outputDir: path.join(dir, "frames"), fps: 4, width: 160 });
    assert.equal(frames.count, 4);
    const files = await readdir(path.join(dir, "frames"));
    assert.equal(files.length, 4);

    const joined = await concatMedia({
      inputs: [a, b],
      output: path.join(dir, "joined.mp4"),
      width: 480,
      height: 270,
      fps: 10,
    });
    assert.equal(joined.width, 480);
    assert.equal(joined.height, 270);
    const joinedInfo = await probeMedia(joined.output);
    assert.ok(Math.abs(joinedInfo.duration - 2) < 0.2);
    assert.ok(joinedInfo.audio, "concat should add silence when an input has no audio");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

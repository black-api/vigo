import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, probeMedia, projectDuration, resolveProjectPath } from "../dist/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

for (const [kind, minimum, voiceClips] of [
  ["ad", 25, 6],
  ["explainer", 150, 10],
]) {
  test(`${kind} demo project is complete and narrated`, async () => {
    const projectFile = path.join(ROOT, "examples", kind, "vigo.json");
    const composition = await loadProject(projectFile);
    const duration = projectDuration(composition);
    assert.ok(duration >= minimum, `${kind} is ${duration}s, expected >= ${minimum}s`);

    const visual = composition.tracks.find((track) => track.type === "html");
    const voice = composition.tracks.find((track) => track.id === "voice");
    assert.ok(visual && visual.clips.length > 0, "expected visual scenes");
    assert.ok(voice, "expected a voice track");
    assert.equal(voice.clips.length, voiceClips);

    for (const clip of visual.clips) {
      const source = path.join(path.dirname(projectFile), clip.src);
      assert.ok(existsSync(source), `missing scene ${source}`);
    }
    for (const clip of voice.clips) {
      const file = resolveProjectPath(projectFile, clip.src);
      assert.ok(existsSync(file), `missing narration ${file}`);
      const info = await probeMedia(file);
      assert.ok(info.audio, `narration has no audio stream: ${file}`);
      assert.ok(info.duration > 1, `narration is too short: ${file}`);
    }
    assert.ok(existsSync(path.join(ROOT, "examples", kind, "script.md")), "expected script.md");
    assert.ok(existsSync(path.join(ROOT, "examples", kind, "audio", "music.mp3")), "expected music bed");
  });
}

for (const [kind, minimum] of [
  ["ad", 25],
  ["explainer", 150],
]) {
  const file = path.join(ROOT, "renders", `vigo-${kind}.mp4`);
  test(`rendered ${kind} has video and audio`, { skip: !existsSync(file) && "not rendered" }, async () => {
    const info = await probeMedia(file);
    assert.equal(info.video.codec, "h264");
    assert.equal(info.video.width, 1280);
    assert.equal(info.video.height, 720);
    assert.ok(info.audio, "expected narrated audio");
    assert.ok(info.duration >= minimum, `${kind} render is ${info.duration}s`);
  });
}

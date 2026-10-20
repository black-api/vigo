import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addClip,
  addTrack,
  createComposition,
  loadProject,
  moveClip,
  projectDuration,
  removeClip,
  setClip,
  splitClip,
  summarizeComposition,
  trimClip,
  validateComposition,
  saveProject,
} from "../dist/index.js";

test("create, validate, add, split, trim, move, remove", () => {
  const comp = createComposition({ name: "unit", width: 640, height: 360, fps: 30 });
  assert.equal(comp.tracks.length, 2);
  const intro = addClip(comp, "main", { src: "scenes/intro.html", start: 0, duration: 4 });
  assert.equal(intro.id, "intro");
  const body = addClip(comp, "main", { src: "scenes/body.html", duration: 3 });
  assert.equal(body.start, 4);
  assert.equal(projectDuration(comp), 7);

  const split = splitClip(comp, "body", 5.5);
  assert.equal(split.first.duration, 1.5);
  assert.equal(split.second.start, 5.5);
  assert.equal(split.second.duration, 1.5);
  assert.equal(split.second.offset, 1.5);

  trimClip(comp, "body-b", { duration: 1, offset: 2 });
  assert.equal(comp.tracks[0].clips.find((c) => c.id === "body-b").duration, 1);
  moveClip(comp, "body-b", 8);
  setClip(comp, "body-b", { label: "outro", volume: 1 });
  assert.equal(comp.tracks[0].clips.find((c) => c.id === "body-b").label, "outro");
  removeClip(comp, "body-b");

  assert.deepEqual(validateComposition(comp), []);
  assert.equal(projectDuration(comp), 5.5);
  const summary = summarizeComposition(comp);
  assert.equal(summary.tracks[0].clips.length, 2);
});

test("overlaps and invalid structure are rejected", () => {
  const comp = createComposition({ width: 640, height: 360, fps: 30 });
  addClip(comp, "main", { src: "a.html", start: 0, duration: 4 });
  assert.throws(
    () => addClip(comp, "main", { src: "b.html", start: 2, duration: 3 }),
    /overlaps/,
  );

  const odd = createComposition({ width: 641, height: 360, fps: 30 });
  assert.match(validateComposition(odd).join("\n"), /width must be even/);

  const mismatch = createComposition({ width: 640, height: 360, fps: 30 });
  addClip(mismatch, "main", { src: "a.html", duration: 1 });
  mismatch.tracks[0].clips[0].kind = "video";
  assert.match(validateComposition(mismatch).join("\n"), /html track can only hold html clips/);
});

test("clip ids stay unique across tracks", () => {
  const comp = createComposition({ width: 640, height: 360, fps: 30 });
  addTrack(comp, "html", "overlay");
  addClip(comp, "main", { src: "scenes/scene.html", duration: 2 });
  const second = addClip(comp, "overlay", { src: "scenes/scene.html", duration: 2 });
  assert.notEqual(second.id, "scene");
  addClip(comp, "overlay", { id: "scene-b", src: "scenes/other.html", start: 2, duration: 1 });
  assert.deepEqual(validateComposition(comp), []);
  const split = splitClip(comp, "scene", 1);
  assert.deepEqual(validateComposition(comp), []);
  assert.notEqual(split.second.id, "scene-b");
});

test("audio duration auto-fill and track creation helpers", () => {
  const comp = createComposition({ width: 640, height: 360, fps: 30 });
  const media = addTrack(comp, "media", "broll");
  assert.equal(media.type, "media");
  const overlay = addTrack(comp, "html", "overlay");
  assert.equal(comp.tracks.at(-1).type, "audio");
  assert.ok(comp.tracks.findIndex((t) => t.id === overlay.id) < comp.tracks.length - 1);

  addClip(comp, "broll", { kind: "video", src: "clip.mp4", start: 0, duration: 2, fit: "cover" });
  addClip(comp, "audio", { kind: "audio", src: "music.mp3", start: 0, duration: 2, volume: 0.5 });
  assert.deepEqual(validateComposition(comp), []);
});

test("projects round-trip through JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vigo-test-"));
  try {
    const file = path.join(dir, "vigo.json");
    const comp = createComposition({ name: "roundtrip", width: 320, height: 180, fps: 10, duration: 3 });
    addClip(comp, "main", { src: "scene.html", duration: 3 });
    addClip(comp, "audio", { kind: "audio", src: "tone.wav", start: 0, duration: 3 });
    await saveProject(file, comp);
    const loaded = await loadProject(file);
    assert.equal(loaded.name, "roundtrip");
    assert.equal(projectDuration(loaded), 3);
    assert.equal(loaded.tracks[0].clips[0].src, "scene.html");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

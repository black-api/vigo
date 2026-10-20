#!/usr/bin/env node
/**
 * Regenerate the two demo deliverables:
 *   renders/vigo-ad.mp4          ~30s vertical slice
 *   renders/vigo-explainer.mp4   ~3-4 minute narrated walkthrough
 *
 * Voice: Edge neural TTS (real spoken narration). Music: generated synth bed.
 * Everything else is produced by vigo itself.
 *
 * Usage:
 *   node scripts/build-demos.mjs
 *   node scripts/build-demos.mjs --only=ad
 *   node scripts/build-demos.mjs --skip-render
 *   node scripts/build-demos.mjs --preview
 *   node scripts/build-demos.mjs --manifest-only
 *   node scripts/build-demos.mjs --force-voice
 *
 * The Edge TTS binary is looked up via EDGE_TTS, a local venv, or PATH.
 *   python3 -m venv .venv && .venv/bin/pip install edge-tts
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { probeMedia, renderProject, saveProject } from "../dist/index.js";
import { thumbnail } from "../dist/media/ops.js";
import { findChromium } from "../dist/render/browser.js";
import { AD_SECTIONS, EXPLAINER_SECTIONS, scenePage } from "./demo-scenes.mjs";

const exec = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const hit = args.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const only = option("only", "all");
const preview = flag("preview");
const skipRender = flag("skip-render");
const manifestOnly = flag("manifest-only");
const forceVoice = flag("force-voice");
const reuseVoice = flag("reuse-voice");
const voice = option("voice", process.env.VIGO_VOICE || "en-US-AndrewMultilingualNeural");

const log = (message) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${message}\n`);

function findEdgeTts() {
  const candidates = [
    process.env.EDGE_TTS,
    path.join(ROOT, ".venv", "bin", "edge-tts"),
    "/tmp/vigo-tts/bin/edge-tts",
    "edge-tts",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate.includes("/") || existsSync(candidate)) return candidate;
  }
  throw new Error("edge-tts not found. Install it: python3 -m venv .venv && .venv/bin/pip install edge-tts");
}

const EDGE = findEdgeTts();

async function run(command, commandArgs, options = {}) {
  try {
    return await exec(command, commandArgs, { maxBuffer: 20 * 1024 * 1024, ...options });
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr.slice(-800)}` : "";
    throw new Error(`${command} failed: ${error.message}${stderr}`);
  }
}

async function synthVoice(text, outFile, rate, vttOut) {
  const raw = `${outFile}.raw.mp3`;
  const vtt = `${outFile}.vtt`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await run(EDGE, [
        "--voice", voice,
        "--rate", rate,
        "--text", text,
        "--write-media", raw,
        "--write-subtitles", vtt,
      ], { timeout: 90_000, killSignal: "SIGKILL" });
      const rawInfo = await probeMedia(raw);
      const subtitles = existsSync(vtt) ? (await readFile(vtt, "utf8")).trim() : "";
      if (rawInfo.duration < 0.8 || subtitles.length < 10) {
        throw new Error(`TTS produced unusable audio (${rawInfo.duration.toFixed(2)}s, ${subtitles.length} subtitle chars)`);
      }
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      log(`  tts attempt ${attempt} failed: ${error.message.split("\n")[0]}`);
      await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }
  if (lastError) throw lastError;
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", raw,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar", "48000", "-ac", "2",
    "-c:a", "libmp3lame", "-b:a", "192k",
    outFile,
  ]);
  await rm(raw, { force: true });
  if (vttOut) {
    await mkdir(path.dirname(vttOut), { recursive: true });
    await copyFile(vtt, vttOut).catch(() => {});
  }
  await rm(vtt, { force: true });
}

function wavHeader(dataBytes, sampleRate, channels) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/** Deterministic synth bed: warm pad, sub, and (for the ad) a soft pulse. */
async function makeMusic(seconds, kind, outFile) {
  const sampleRate = 48000;
  const samples = Math.ceil(seconds * sampleRate);
  const data = Buffer.alloc(samples * 4);
  const progression = [
    [110, 164.81, 220, 329.63],
    [87.31, 174.61, 220, 349.23],
    [130.81, 196, 261.63, 392],
    [98, 146.83, 196, 293.66],
  ];
  const chordDuration = kind === "ad" ? 4 : 8;
  const crossfade = kind === "ad" ? 1.1 : 2.2;
  const beat = 60 / (kind === "ad" ? 84 : 64);
  const isAd = kind === "ad";
  let peak = 0;
  // Interleaved stereo: two float slots per frame.
  const buffer = new Float32Array(samples * 2);

  const pad = (chord, t) => {
    let value = 0;
    chord.forEach((frequency, index) => {
      const detune = 1 + (index % 2 === 0 ? 0.0025 : -0.002);
      value += Math.sin(2 * Math.PI * frequency * detune * t + index * 0.7) * 0.028;
      value += Math.sin(2 * Math.PI * frequency * (2 - detune) * t + index * 1.1) * 0.012;
    });
    return value;
  };

  for (let index = 0; index < samples; index += 1) {
    const t = index / sampleRate;
    const chordIndex = Math.floor(t / chordDuration) % progression.length;
    const nextIndex = (chordIndex + 1) % progression.length;
    const local = t % chordDuration;
    const fadeStart = chordDuration - crossfade;
    const blend = Math.min(1, Math.max(0, (local - fadeStart) / crossfade));
    const current = progression[chordIndex];
    const next = progression[nextIndex];
    let left = pad(current, t) * (1 - blend) + pad(next, t) * blend;
    let right = left * 0.96;

    const root = current[0];
    const sub = Math.sin(2 * Math.PI * (root / 2) * t) * 0.045;
    left += sub;
    right += sub;

    if (isAd) {
      const kickEnv = Math.exp(-9 * (t % beat));
      const kick = Math.sin(2 * Math.PI * 52 * t) * 0.16 * kickEnv;
      left += kick;
      right += kick;
      const hatEnv = Math.exp(-30 * ((t + beat / 2) % beat));
      const noise = (Math.sin(index * 12.9898) * 43758.5453) % 1;
      left += noise * 0.016 * hatEnv;
      right -= noise * 0.016 * hatEnv;
    }

    const tremolo = 0.86 + 0.14 * Math.sin(2 * Math.PI * 0.07 * t);
    const fadeIn = Math.min(1, t / 2.2);
    const fadeOut = Math.min(1, Math.max(0, (seconds - t) / 4));
    const gain = tremolo * fadeIn * fadeOut;
    left *= gain;
    right *= gain;
    buffer[index * 2] = left;
    buffer[index * 2 + 1] = right;
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
  }

  const scale = peak > 0 ? 0.55 / peak : 1;
  for (let index = 0; index < samples; index += 1) {
    const value = (buffer[index * 2] * scale);
    const other = (buffer[index * 2 + 1] * scale);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), index * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, other)) * 32767), index * 4 + 2);
  }
  const tempWav = `${outFile}.wav`;
  await writeFile(tempWav, Buffer.concat([wavHeader(data.length, sampleRate, 2), data]));
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", tempWav,
    "-c:a", "libmp3lame", "-b:a", "160k",
    outFile,
  ]);
  await rm(tempWav, { force: true });
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

async function checkScenes(files) {
  const browser = await puppeteer.launch({
    executablePath: findChromium(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  });
  const problems = [];
  try {
    for (const file of files) {
      log(`layout: checking ${path.basename(file)}`);
      // A fresh page per scene avoids a stuck navigation poisoning the rest.
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      try {
        await page.goto(pathToFileURL(file).href, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.evaluate(async () => {
          await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3000))]);
          if (window.vigo?.seek) window.vigo.seek(3);
          for (const animation of document.getAnimations()) {
            try {
              animation.pause();
              animation.currentTime = 3000;
            } catch {
              // ignore
            }
          }
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        const issues = await page.evaluate(() => {
        const found = [];
        const selectors = [
          "h1", "h2", "p", ".chip", ".card", ".terminal", ".timeline-card", ".formats",
          ".mcp-diagram", ".arch", ".stats", ".end-cmds", ".end-foot", ".flow", ".filmstrip",
          ".layers", ".hero-art", ".code-window", ".mcp-node", ".guide-pill", ".edit-tags",
          ".ruler", ".tool", ".term-out",
        ].join(",");
        for (const element of document.querySelectorAll(selectors)) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.left < -2 || rect.top < -2 || rect.right > window.innerWidth + 2 || rect.bottom > window.innerHeight + 2) {
            found.push(`outside viewport: <${element.tagName.toLowerCase()} class="${element.className}"> ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
          }
          if (element.scrollWidth > element.clientWidth + 4 && element.clientHeight > 0) {
            found.push(`horizontal overflow: <${element.tagName.toLowerCase()} class="${element.className}"> ${element.scrollWidth}/${element.clientWidth}: ${(element.textContent || "").trim().slice(0, 70)}`);
          }
        }
        if (document.documentElement.scrollWidth > window.innerWidth + 2) {
          found.push(`document scrollWidth ${document.documentElement.scrollWidth}`);
        }
        if (document.documentElement.scrollHeight > window.innerHeight + 2) {
          found.push(`document scrollHeight ${document.documentElement.scrollHeight}`);
        }
        return found;
        });
        if (issues.length > 0) problems.push({ file: path.basename(file), issues });
      } catch (error) {
        problems.push({ file: path.basename(file), issues: [`layout check failed: ${error.message}`] });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
  if (problems.length > 0) {
    for (const problem of problems) {
      log(`layout: ${problem.file}`);
      for (const issue of problem.issues) log(`  - ${issue}`);
    }
    throw new Error("Scene layout check failed");
  }
  log(`layout ok: ${files.length} scenes fit 1280x720`);
}

function writeScriptMarkdown(kind, sections, total, file, extras) {
  const lines = [
    `# vigo ${kind} — narration`,
    "",
    `Voice: \`${voice}\` (Edge neural TTS)`,
    `Total: ${formatClock(total)} (${total.toFixed(2)}s)`,
    "",
    "| # | Scene | Start | Length | Narration |",
    "| --- | --- | --- | --- | --- |",
  ];
  sections.forEach((section, index) => {
    const text = section.voice.replace(/\|/g, "\\|");
    lines.push(
      `| ${index + 1} | ${section.id} | ${formatClock(section.start)} | ${section.duration.toFixed(1)}s | ${text} |`,
    );
  });
  lines.push("", extras, "");
  return lines.join("\n");
}

async function buildVariant({ kind, sections: rawSections, runtime }) {
  const projectDir = path.join(ROOT, "examples", kind);
  const sceneDir = path.join(projectDir, "scenes");
  const audioDir = path.join(projectDir, "audio");
  const captionDir = path.join(projectDir, "captions");
  await mkdir(sceneDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });
  await mkdir(captionDir, { recursive: true });

  const metaFile = path.join(audioDir, "voice.json");
  let voiceMeta = {};
  if (existsSync(metaFile)) {
    voiceMeta = JSON.parse(await readFile(metaFile, "utf8"));
  }
  const rate = kind === "ad" ? "+3%" : "+0%";
  const lead = kind === "ad" ? 0.3 : 0.55;
  const tail = kind === "ad" ? 0.55 : 0.9;

  const sections = [];
  for (const section of rawSections) {
    const audioFile = path.join(audioDir, `${section.id}.mp3`);
    const hash = createHash("sha256").update(`${voice}|${rate}|${section.voice}`).digest("hex");
    const cached = voiceMeta[section.id];
    const shouldSynth = forceVoice || !existsSync(audioFile) || (!reuseVoice && cached?.hash !== hash);
    if (shouldSynth) {
      log(`${kind}: voice ${section.id} (${section.voice.split(" ").length} words)`);
      await synthVoice(section.voice, audioFile, rate, path.join(captionDir, `${section.id}.vtt`));
      voiceMeta[section.id] = { hash, voice, rate, text: section.voice };
    } else {
      log(`${kind}: voice ${section.id} (cached)`);
    }
    const info = await probeMedia(audioFile);
    const duration = Math.max(section.minDuration, info.duration + lead + tail);
    sections.push({ ...section, audioDuration: info.duration, duration });
  }
  await writeFile(metaFile, `${JSON.stringify(voiceMeta, null, 2)}\n`);

  let cursor = 0;
  for (const section of sections) {
    section.start = Number(cursor.toFixed(3));
    section.audioStart = Number((section.start + lead).toFixed(3));
    cursor += section.duration;
  }
  const total = Number(cursor.toFixed(3));
  log(`${kind}: ${sections.length} scenes, ${formatClock(total)} total`);

  for (const section of sections) {
    const html = scenePage({
      title: section.title,
      chapter: section.chapter,
      body: section.body(),
      start: section.start,
      duration: section.duration,
      total,
      seekCode: section.seekCode || "",
    });
    await writeFile(path.join(sceneDir, `${section.id}.html`), html, "utf8");
  }

  const musicFile = path.join(audioDir, "music.mp3");
  const cachedMusic = existsSync(musicFile) ? await probeMedia(musicFile) : null;
  if (!cachedMusic || cachedMusic.duration < total || flag("force-music")) {
    log(`${kind}: synth music bed`);
    await makeMusic(total + 2, kind, musicFile);
  } else {
    log(`${kind}: music bed (cached)`);
  }
  const musicInfo = await probeMedia(musicFile);
  if (musicInfo.duration < total) throw new Error("music bed is too short");

  const fps = runtime.fps;
  const composition = {
    version: 1,
    name: `vigo-${kind}`,
    width: runtime.width,
    height: runtime.height,
    fps,
    duration: total,
    background: "#05070d",
    tracks: [
      {
        id: "main",
        type: "html",
        clips: sections.map((section) => ({
          id: section.id,
          kind: "html",
          src: `scenes/${section.id}.html`,
          start: section.start,
          duration: Number(section.duration.toFixed(3)),
        })),
      },
      {
        id: "voice",
        type: "audio",
        clips: sections.map((section) => ({
          id: `${section.id}-vo`,
          kind: "audio",
          src: `audio/${section.id}.mp3`,
          start: section.audioStart,
          duration: Number(section.audioDuration.toFixed(3)),
          volume: 1,
          fadeIn: 0.03,
          fadeOut: 0.12,
        })),
      },
      {
        id: "music",
        type: "audio",
        clips: [
          {
            id: "music-bed",
            kind: "audio",
            src: "audio/music.mp3",
            start: 0,
            duration: total,
            volume: kind === "ad" ? 0.16 : 0.085,
            fadeIn: 2,
            fadeOut: 3,
          },
        ],
      },
    ],
  };

  const projectFile = path.join(projectDir, "vigo.json");
  await saveProject(projectFile, composition);
  log(`${kind}: wrote ${projectFile}`);

  const scriptMd = writeScriptMarkdown(
    kind,
    sections,
    total,
    path.join(projectDir, "script.md"),
    [
      "## Render",
      "",
      "```bash",
      `node dist/cli.js render examples/${kind}/vigo.json -o renders/vigo-${kind}.mp4`,
      "```",
      "",
      "All HTML lives in `scenes/`. Narration is in `audio/`. The timeline is `vigo.json`.",
    ].join("\n"),
  );
  await writeFile(path.join(projectDir, "script.md"), scriptMd, "utf8");

  return { kind, projectFile, projectDir, sections, total, composition, fps, runtime, sceneDir };
}

/** Poster timestamps (seconds into the final cut) that land on a legible frame. */
const POSTER_TIME = { ad: 2, explainer: 8 };

async function describeRender(variant, output) {
  const info = await probeMedia(output);
  const poster = path.join(path.dirname(output), `${path.basename(output, path.extname(output))}-poster.jpg`);
  await thumbnail(output, { output: poster, at: POSTER_TIME[variant.kind] ?? 2, width: 1280 });
  return {
    kind: preview ? "preview" : "final",
    file: path.relative(ROOT, output),
    poster: path.relative(ROOT, poster),
    project: path.relative(ROOT, variant.projectFile),
    scenes: variant.sections.length,
    duration: info.duration,
    width: info.video.width,
    height: info.video.height,
    fps: info.video.fps,
    audio: info.audio,
    sizeBytes: info.size,
  };
}

async function renderVariant(variant) {
  const dir = path.join(ROOT, "renders");
  await mkdir(dir, { recursive: true });
  const output = path.join(dir, preview ? `vigo-${variant.kind}.preview.mp4` : `vigo-${variant.kind}.mp4`);
  const width = preview ? 640 : variant.runtime.width;
  const height = preview ? 360 : variant.runtime.height;
  const fps = preview ? 12 : variant.runtime.fps;
  log(`${variant.kind}: rendering ${width}x${height} @ ${fps}fps -> ${output}`);
  let lastBucket = -1;
  const result = await renderProject(variant.projectFile, {
    output,
    width,
    height,
    fps,
    crf: preview ? 26 : 20,
    preset: preview ? "veryfast" : "medium",
    frameFormat: variant.runtime.frameFormat,
    jpegQuality: variant.runtime.jpegQuality,
    onProgress: (progress) => {
      if (progress.phase === "frames") {
        const bucket = Math.floor(progress.percent / 5);
        if (bucket !== lastBucket) {
          lastBucket = bucket;
          log(`${variant.kind}: ${progress.percent.toFixed(0)}% (${progress.frame}/${progress.totalFrames})`);
        }
      }
    },
  });
  const info = await probeMedia(output);
  log(`${variant.kind}: done ${formatClock(info.duration)} ${info.video.width}x${info.video.height} audio=${info.audio ? info.audio.codec : "none"} size=${(info.size / 1024 / 1024).toFixed(1)}MB`);
  return { ...result, info, output, preview, describe: await describeRender(variant, output) };
}

async function main() {
  if (!existsSync(path.join(ROOT, "dist", "index.js"))) {
    throw new Error("dist/ is missing. Run: npm run build");
  }
  const variants = [];
  if (only === "all" || only === "ad") {
    variants.push(await buildVariant({
      kind: "ad",
      sections: AD_SECTIONS,
      runtime: { width: 1280, height: 720, fps: 30, frameFormat: "jpeg", jpegQuality: 94 },
    }));
  }
  if (only === "all" || only === "explainer") {
    variants.push(await buildVariant({
      kind: "explainer",
      sections: EXPLAINER_SECTIONS,
      runtime: { width: 1280, height: 720, fps: 24, frameFormat: "jpeg", jpegQuality: 94 },
    }));
  }

  await checkScenes(variants.flatMap((variant) => variant.sections.map((section) => path.join(variant.sceneDir, `${section.id}.html`))));

  if (skipRender) {
    log("skip-render: projects and assets are ready");
    return;
  }

  const items = [];
  if (manifestOnly) {
    for (const variant of variants) {
      const output = path.join(ROOT, "renders", `vigo-${variant.kind}.mp4`);
      if (!existsSync(output)) throw new Error(`missing render: ${output}`);
      items.push({ ...(await describeRender(variant, output)), kind: "final" });
      log(`${variant.kind}: manifest refreshed`);
    }
  } else {
    for (const variant of variants) {
      const result = await renderVariant(variant);
      items.push(result.describe);
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    voice,
    items,
  };
  await writeFile(path.join(ROOT, "renders", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log("wrote renders/manifest.json");
}

main().catch((error) => {
  process.stderr.write(`\nbuild-demos failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

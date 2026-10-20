#!/usr/bin/env node
import path from "node:path";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { VigoError, asVigoError } from "./errors.ts";
import { GUIDE_MARKDOWN } from "./guide.ts";
import { ensureDir, formatDuration, slugify, toNumber, writeJson } from "./util/fsx.ts";
import { probeMedia, toolVersion } from "./media/ffmpeg.ts";
import { diagnose } from "./system.ts";
import { addClipToProject } from "./core/project-ops.ts";
import { concatMedia, convertMedia, extractFrames, thumbnail } from "./media/ops.ts";
import {
  addTrack,
  createComposition,
  loadProject,
  removeClip,
  removeTrack,
  setClip,
  splitClip,
  summarizeComposition,
  trimClip,
  moveClip,
  validateComposition,
  verifyProjectFiles,
} from "./core/timeline.ts";
import type { ClipKind, Composition, TrackType } from "./core/types.ts";
import { htmlToVideo, renderProject, type RenderProgress } from "./render/render.ts";
import { findChromium } from "./render/browser.ts";

type FlagValue = string | boolean;
type Flags = Record<string, FlagValue>;

const COMMON_FLAGS = new Set(["json", "quiet", "help", "h"]);

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && (!next.startsWith("-") || /^-\d/.test(next))) {
          flags[body] = next;
          i += 1;
        } else {
          flags[body] = true;
        }
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length === 2) {
      const alias: Record<string, string> = { o: "output", q: "quiet", h: "help", v: "version" };
      const name = alias[arg.slice(1)] ?? arg.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && (!next.startsWith("-") || /^-\d/.test(next))) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags };
}

function ensureFlags(flags: Flags, allowed: string[]): void {
  const allowedSet = new Set([...COMMON_FLAGS, ...allowed]);
  const unknown = Object.keys(flags).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new VigoError("E_USAGE", `Unknown flag${unknown.length > 1 ? "s" : ""}: ${unknown.map((k) => `--${k}`).join(", ")}`);
  }
}

function str(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function num(flags: Flags, key: string): number | undefined {
  const value = flags[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new VigoError("E_USAGE", `--${key} needs a value`);
  return toNumber(value);
}

function bool(flags: Flags, key: string): boolean {
  return flags[key] === true || flags[key] === "true" || flags[key] === "1";
}

function parseFrameFormat(value: string | undefined): "png" | "jpeg" | undefined {
  if (value === undefined) return undefined;
  if (value === "png" || value === "jpeg") return value;
  throw new VigoError("E_USAGE", "--frame-format must be png or jpeg");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString("utf8");
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new VigoError("E_USAGE", message);
  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function progressRenderer(enabled: boolean): (progress: RenderProgress) => void {
  let lastPercent = -1;
  let lastPhase = "";
  return (progress) => {
    if (!enabled) return;
    if (progress.phase === "frames") {
      const percent = Math.floor(progress.percent);
      if (percent === lastPercent) return;
      lastPercent = percent;
      lastPhase = "frames";
      process.stderr.write(`\rrendering ${progress.frame}/${progress.totalFrames} frames (${percent}%)   `);
      return;
    }
    if (progress.phase !== lastPhase) {
      if (lastPhase === "frames") process.stderr.write("\n");
      lastPhase = progress.phase;
      if (progress.phase === "encode") process.stderr.write("encoding video...\n");
      if (progress.phase === "done") process.stderr.write("done\n");
    }
  };
}

const SAMPLE_SCENE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #0b0d12; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #f5f7ff; }
  .stage { position: relative; display: grid; place-items: center; height: 100%; padding: 8vw; box-sizing: border-box; }
  .glow { position: absolute; width: 46vw; height: 46vw; border-radius: 50%; filter: blur(80px); opacity: .45;
    background: radial-gradient(circle, #4f8cff 0%, #8b5cf6 45%, transparent 70%); }
  .content { position: relative; text-align: left; width: 100%; }
  .eyebrow { font-size: 1.2vw; letter-spacing: .5em; text-transform: uppercase; color: #8fb4ff;
    animation: fade-in .8s ease-out both; }
  h1 { margin: 1.2rem 0 1.6rem; font-size: 7vw; line-height: .98; letter-spacing: -.035em;
    animation: rise 1.2s cubic-bezier(.16, 1, .3, 1) both; }
  h1 span { color: #8fb4ff; }
  p { margin: 0; font-size: 1.5vw; line-height: 1.6; color: #aab4cc; max-width: 60%;
    animation: fade-in .9s ease-out .5s both; }
  .bar { position: absolute; left: 8vw; bottom: 8vh; width: 0; height: 2px; background: #4f8cff;
    animation: grow 4s linear both; }
  @keyframes rise { from { opacity: 0; transform: translateY(4vw); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes grow { from { width: 0; } to { width: 84vw; } }
</style>
</head>
<body>
  <div class="stage">
    <div class="glow"></div>
    <div class="content">
      <div class="eyebrow">vigo</div>
      <h1>Made with HTML.<br /><span>Rendered by agents.</span></h1>
      <p>Edit this file, then render the project. Every frame is deterministic, so agents can iterate safely.</p>
    </div>
    <div class="bar"></div>
  </div>
</body>
</html>
`;

const HELP = `vigo — lightweight, agent-first video engine

Usage: vigo <command> [options]

Core:
  init [dir|project.json]        Create a project + sample scene
  render <project>               Render a project to mp4/webm/mov/mkv
                                 (--frame-format png|jpeg for speed)
  html2video <scene.html|->      Turn one HTML file into a video
  add <project> --src <file>     Add a clip to a track
  trim/split/move/rm/set         Edit clips in the JSON timeline
  track add|rm                   Manage tracks
  inspect <project>              Show a compact timeline summary
  check <project>                Validate project, files, and tools

Media:
  convert <input> -o <output>    Convert video/audio/image formats
  concat <input...> -o <output>  Join clips (normalizes size/fps/audio)
  probe <input>                  Inspect media metadata
  thumb <input> -o <file>        Extract a poster frame
  frames <input> -o <dir>        Extract frames

Agent:
  mcp                            Run the MCP server on stdio
  guide                          Print the full agent guide

Every command supports --json. Progress is written to stderr.
Run 'vigo guide' for the timeline format and HTML animation contract.
`;

export async function runCli(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const json = bool(flags, "json");
  const quiet = bool(flags, "quiet");
  const command = positional[0];

  if (bool(flags, "version") || command === "version") {
    process.stdout.write("vigo 0.1.0\n");
    return 0;
  }

  if (!command || bool(flags, "help") || command === "help") {
    if (command && command !== "help" && bool(flags, "help")) {
      process.stdout.write(HELP);
      return 0;
    }
    process.stdout.write(HELP);
    return 0;
  }

  try {
    switch (command) {
      case "guide":
        process.stdout.write(GUIDE_MARKDOWN);
        return 0;
      case "doctor":
        return await doctor(flags, json);
      case "init":
        return await initProject(positional, flags, json);
      case "render":
        return await render(positional, flags, json, quiet);
      case "html2video":
        return await html2video(positional, flags, json, quiet);
      case "convert":
        return await convert(positional, flags, json);
      case "concat":
        return await concat(positional, flags, json);
      case "probe":
        return await probe(positional, flags, json);
      case "thumb":
        return await thumb(positional, flags, json);
      case "frames":
        return await frames(positional, flags, json);
      case "add":
        return await add(positional, flags, json);
      case "trim":
        return await trim(positional, flags, json);
      case "split":
        return await split(positional, flags, json);
      case "move":
        return await move(positional, flags, json);
      case "rm":
        return await rm(positional, flags, json);
      case "set":
        return await set(positional, flags, json);
      case "track":
        return await track(positional, flags, json);
      case "inspect":
        return await inspect(positional, flags, json);
      case "check":
        return await check(positional, flags, json);
      case "mcp": {
        const { runMcpServer } = await import("./mcp/server.ts");
        await runMcpServer();
        return 0;
      }
      default:
        throw new VigoError("E_USAGE", `Unknown command "${command}". Run "vigo help".`);
    }
  } catch (error) {
    const vigoError = asVigoError(error);
    if (json) {
      printJson({
        ok: false,
        error: { code: vigoError.code, message: vigoError.message, ...(vigoError.details ? { details: vigoError.details } : {}) },
      });
    } else {
      process.stderr.write(`error: ${vigoError.message}\n`);
      if (vigoError.details && Array.isArray(vigoError.details)) {
        for (const detail of vigoError.details) process.stderr.write(`  - ${String(detail)}\n`);
      }
    }
    return vigoError.code === "E_USAGE" ? 2 : 1;
  }
}

async function doctor(flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, []);
  const result = await diagnose();
  if (json) printJson(result);
  else {
    process.stdout.write(`node      ${result.tools.node}\n`);
    process.stdout.write(`ffmpeg    ${result.tools.ffmpeg ?? "MISSING"}\n`);
    process.stdout.write(`ffprobe   ${result.tools.ffprobe ?? "MISSING"}\n`);
    process.stdout.write(
      `chromium  ${result.tools.chromium ?? "MISSING"}${result.tools.chromiumPath ? ` (${result.tools.chromiumPath})` : ""}\n`,
    );
    if (result.tools.error) process.stdout.write(`          ${result.tools.error}\n`);
    process.stdout.write(result.ok ? "\nvigo is ready.\n" : "\nvigo is missing a dependency.\n");
  }
  return result.ok ? 0 : 1;
}

async function initProject(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, ["name", "width", "height", "fps", "duration", "background", "force"]);
  const raw = positional[1] ?? "vigo-project";
  const projectFile = raw.toLowerCase().endsWith(".json") ? path.resolve(raw) : path.resolve(raw, "vigo.json");
  const dir = path.dirname(projectFile);
  const name = str(flags, "name") ?? path.basename(dir);
  const duration = num(flags, "duration") ?? 5;
  const composition = createComposition({
    name,
    width: num(flags, "width") ?? 1920,
    height: num(flags, "height") ?? 1080,
    fps: num(flags, "fps") ?? 30,
    duration,
    background: str(flags, "background") ?? "#0b0d12",
  });
  const errors = validateComposition(composition);
  if (errors.length > 0) throw new VigoError("E_PROJECT_INVALID", "Invalid init options", errors);
  if (duration <= 0) throw new VigoError("E_USAGE", "--duration must be > 0");

  const forced = bool(flags, "force");
  if (existsSync(projectFile) && !forced) {
    throw new VigoError("E_EXISTS", `${projectFile} already exists (use --force to overwrite)`);
  }

  const scenePath = path.join(dir, "scenes", "intro.html");
  composition.tracks[0]?.clips.push({
    id: "intro",
    kind: "html",
    src: "scenes/intro.html",
    start: 0,
    duration,
  });

  await ensureDir(path.dirname(scenePath));
  await writeFile(scenePath, SAMPLE_SCENE, { encoding: "utf8", flag: forced ? "w" : "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") return;
    throw error;
  });
  await writeJson(projectFile, composition);

  const summary = summarizeComposition(composition, projectFile);
  if (json) {
    printJson({ ok: true, project: projectFile, scene: scenePath, summary });
  } else {
    process.stdout.write(`created ${projectFile}\ncreated ${scenePath}\n\n`);
    const relative = path.relative(process.cwd(), projectFile);
    const display = !relative || relative.startsWith("..") ? projectFile : relative;
    process.stdout.write(`next:\n  vigo render ${display}\n`);
  }
  return 0;
}

async function render(positional: string[], flags: Flags, json: boolean, quiet: boolean): Promise<number> {
  ensureFlags(flags, [
    "output", "width", "height", "fps", "duration", "crf", "preset",
    "frames-dir", "keep-frames", "frame-format", "jpeg-quality",
  ]);
  const frameFormat = parseFrameFormat(str(flags, "frame-format"));
  const projectFile = path.resolve(required(positional[1], "Usage: vigo render <project.json> [-o out.mp4]"));
  const composition = await loadProject(projectFile);
  const output = path.resolve(
    str(flags, "output") ??
      path.join(path.dirname(projectFile), "out", `${slugify(composition.name ?? "video")}.mp4`),
  );
  const progress = progressRenderer(!json && !quiet);
  const result = await renderProject(projectFile, {
    output,
    width: num(flags, "width"),
    height: num(flags, "height"),
    fps: num(flags, "fps"),
    duration: num(flags, "duration"),
    crf: num(flags, "crf"),
    preset: str(flags, "preset"),
    framesDir: str(flags, "frames-dir"),
    keepFrames: bool(flags, "keep-frames") || Boolean(str(flags, "frames-dir")),
    frameFormat,
    jpegQuality: num(flags, "jpeg-quality"),
    onProgress: progress,
  });
  if (json) {
    printJson({ ok: true, ...result });
  } else {
    process.stdout.write(
      `rendered ${result.output} (${result.width}x${result.height}, ${result.fps}fps, ${formatDuration(result.duration)}) in ${(result.elapsedMs / 1000).toFixed(1)}s\n`,
    );
  }
  return 0;
}

async function html2video(positional: string[], flags: Flags, json: boolean, quiet: boolean): Promise<number> {
  ensureFlags(flags, [
    "output", "html", "duration", "width", "height", "fps", "background",
    "audio", "audio-volume", "audio-start", "fade-in", "fade-out", "crf", "preset",
    "frame-format", "jpeg-quality",
  ]);
  let html = str(flags, "html");
  let htmlPath: string | undefined;
  const input = positional[1];
  if (html === undefined && input) {
    if (input === "-") {
      html = await readStdin();
    } else if (input.startsWith("<") || /<!doctype|<html/i.test(input)) {
      html = input;
    } else {
      const resolved = path.resolve(input);
      if (!existsSync(resolved)) throw new VigoError("E_FILE_NOT_FOUND", `HTML file not found: ${resolved}`);
      htmlPath = resolved;
    }
  }
  if (!html && !htmlPath) {
    throw new VigoError("E_USAGE", "Usage: vigo html2video <scene.html|-> -o out.mp4 (or --html '<html>...')");
  }
  const base = htmlPath ? path.basename(htmlPath, path.extname(htmlPath)) : "video";
  const output = path.resolve(str(flags, "output") ?? path.join("out", `${slugify(base)}.mp4`));
  const result = await htmlToVideo({
    ...(html !== undefined ? { html } : {}),
    ...(htmlPath ? { htmlPath } : {}),
    output,
    duration: num(flags, "duration"),
    width: num(flags, "width"),
    height: num(flags, "height"),
    fps: num(flags, "fps"),
    background: str(flags, "background"),
    audio: str(flags, "audio") ? path.resolve(str(flags, "audio") as string) : undefined,
    audioVolume: num(flags, "audio-volume"),
    audioStart: num(flags, "audio-start"),
    fadeIn: num(flags, "fade-in"),
    fadeOut: num(flags, "fade-out"),
    crf: num(flags, "crf"),
    preset: str(flags, "preset"),
    frameFormat: parseFrameFormat(str(flags, "frame-format")),
    jpegQuality: num(flags, "jpeg-quality"),
    onProgress: progressRenderer(!json && !quiet),
  });
  if (json) printJson({ ok: true, ...result });
  else {
    process.stdout.write(
      `rendered ${result.output} (${result.width}x${result.height}, ${result.fps}fps, ${formatDuration(result.duration)}) in ${(result.elapsedMs / 1000).toFixed(1)}s\n`,
    );
  }
  return 0;
}

async function convert(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, ["output", "start", "duration", "width", "height", "fps", "crf", "preset", "no-audio"]);
  const input = path.resolve(required(positional[1], "Usage: vigo convert <input> -o <output>"));
  const output = path.resolve(required(str(flags, "output"), "convert needs -o <output>"));
  const result = await convertMedia(input, {
    output,
    start: num(flags, "start"),
    duration: num(flags, "duration"),
    width: num(flags, "width"),
    height: num(flags, "height"),
    fps: num(flags, "fps"),
    crf: num(flags, "crf"),
    preset: str(flags, "preset"),
    keepAudio: !bool(flags, "no-audio"),
  });
  if (json) printJson({ ok: true, ...result });
  else {
    process.stdout.write(
      `converted ${result.input} -> ${result.output}${result.width ? ` (${result.width}x${result.height})` : ""} in ${formatDuration(result.duration)}\n`,
    );
  }
  return 0;
}

async function concat(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, ["output", "width", "height", "fps", "crf", "preset"]);
  const inputs = positional.slice(1).map((file) => path.resolve(file));
  if (inputs.length === 0) throw new VigoError("E_USAGE", "Usage: vigo concat <input...> -o <output>");
  const output = path.resolve(str(flags, "output") ?? path.join("out", "concat.mp4"));
  const result = await concatMedia({
    inputs,
    output,
    width: num(flags, "width"),
    height: num(flags, "height"),
    fps: num(flags, "fps"),
    crf: num(flags, "crf"),
    preset: str(flags, "preset"),
  });
  if (json) printJson({ ok: true, ...result });
  else {
    process.stdout.write(
      `concatenated ${inputs.length} clips -> ${result.output} (${result.width}x${result.height}, ${formatDuration(result.duration)})\n`,
    );
  }
  return 0;
}

async function probe(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, []);
  const input = path.resolve(required(positional[1], "Usage: vigo probe <input>"));
  const info = await probeMedia(input);
  if (json) printJson({ ok: true, ...info });
  else {
    process.stdout.write(`${info.path}\n`);
    process.stdout.write(`duration  ${formatDuration(info.duration)} (${info.duration}s)\n`);
    process.stdout.write(`format    ${info.format}\n`);
    if (info.video) {
      process.stdout.write(`video     ${info.video.codec} ${info.video.width}x${info.video.height} @ ${info.video.fps.toFixed(2)}fps\n`);
    }
    if (info.audio) {
      process.stdout.write(`audio     ${info.audio.codec} ${info.audio.sampleRate}Hz ${info.audio.channels}ch\n`);
    }
    process.stdout.write(`size      ${(info.size / 1024 / 1024).toFixed(2)} MB\n`);
  }
  return 0;
}

async function thumb(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, ["output", "at", "width"]);
  const input = path.resolve(required(positional[1], "Usage: vigo thumb <input> [-o out.png]"));
  const output = path.resolve(
    str(flags, "output") ?? path.join(path.dirname(input), `${path.basename(input, path.extname(input))}-thumb.png`),
  );
  const result = await thumbnail(input, { output, at: num(flags, "at"), width: num(flags, "width") });
  if (json) printJson({ ok: true, ...result });
  else process.stdout.write(`wrote ${result.output}\n`);
  return 0;
}

async function frames(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, ["output", "fps", "start", "duration", "width", "format"]);
  const input = path.resolve(required(positional[1], "Usage: vigo frames <input> -o <dir>"));
  const outputDir = path.resolve(required(str(flags, "output"), "frames needs -o <dir>"));
  const formatFlag = str(flags, "format");
  if (formatFlag && formatFlag !== "png" && formatFlag !== "jpg") {
    throw new VigoError("E_USAGE", "--format must be png or jpg");
  }
  const result = await extractFrames(input, {
    outputDir,
    fps: num(flags, "fps"),
    start: num(flags, "start"),
    duration: num(flags, "duration"),
    width: num(flags, "width"),
    format: formatFlag as "png" | "jpg" | undefined,
  });
  if (json) printJson({ ok: true, input, ...result });
  else process.stdout.write(`wrote ${result.count} frames to ${result.outputDir}\n`);
  return 0;
}

async function add(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, [
    "track", "kind", "src", "html", "start", "duration", "offset", "label", "id",
    "fit", "opacity", "volume", "fade-in", "fade-out", "background",
  ]);
  const projectFile = path.resolve(required(positional[1], "Usage: vigo add <project> --src <file>"));
  const result = await addClipToProject(projectFile, {
    ...(str(flags, "track") ? { track: str(flags, "track") } : {}),
    ...(str(flags, "kind") ? { kind: str(flags, "kind") as ClipKind } : {}),
    ...(str(flags, "src") ? { src: str(flags, "src") as string } : {}),
    ...(str(flags, "html") ? { html: str(flags, "html") as string } : {}),
    ...(num(flags, "start") !== undefined ? { start: num(flags, "start") } : {}),
    ...(num(flags, "duration") !== undefined ? { duration: num(flags, "duration") } : {}),
    ...(num(flags, "offset") !== undefined ? { offset: num(flags, "offset") } : {}),
    ...(str(flags, "label") ? { label: str(flags, "label") } : {}),
    ...(str(flags, "id") ? { id: str(flags, "id") } : {}),
    ...(str(flags, "fit") ? { fit: str(flags, "fit") as "contain" | "cover" | "fill" } : {}),
    ...(num(flags, "opacity") !== undefined ? { opacity: num(flags, "opacity") } : {}),
    ...(num(flags, "volume") !== undefined ? { volume: num(flags, "volume") } : {}),
    ...(num(flags, "fade-in") !== undefined ? { fadeIn: num(flags, "fade-in") } : {}),
    ...(num(flags, "fade-out") !== undefined ? { fadeOut: num(flags, "fade-out") } : {}),
    ...(str(flags, "background") ? { background: str(flags, "background") } : {}),
  });

  if (json) {
    printJson({
      ok: true,
      clip: result.clip,
      track: result.trackId,
      duration: result.duration,
      summary: summarizeComposition(result.composition, projectFile),
    });
  } else {
    process.stdout.write(
      `added ${result.clip.kind} clip "${result.clip.id}" to ${result.trackId} at ${result.clip.start}s (${result.clip.duration}s)\n`,
    );
  }
  return 0;
}

async function trim(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, ["start", "duration", "offset", "end"]);
  const { projectFile, composition, clipId } = await editable(positional, "trim");
  const clip = trimClip(composition, clipId, {
    start: num(flags, "start"),
    duration: num(flags, "duration"),
    offset: num(flags, "offset"),
    end: num(flags, "end"),
  });
  await writeJson(projectFile, composition);
  return editResult(json, projectFile, composition, clip, "trimmed");
}

async function split(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, ["at"]);
  const { projectFile, composition, clipId } = await editable(positional, "split");
  const at = num(flags, "at");
  if (at === undefined) throw new VigoError("E_USAGE", "split needs --at <seconds>");
  const { first, second } = splitClip(composition, clipId, at);
  await writeJson(projectFile, composition);
  if (json) printJson({ ok: true, clips: [first, second], summary: summarizeComposition(composition, projectFile) });
  else process.stdout.write(`split "${clipId}" at ${at}s -> "${first.id}" + "${second.id}"\n`);
  return 0;
}

async function move(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, ["to"]);
  const { projectFile, composition, clipId } = await editable(positional, "move");
  const to = num(flags, "to");
  if (to === undefined) throw new VigoError("E_USAGE", "move needs --to <seconds>");
  const clip = moveClip(composition, clipId, to);
  await writeJson(projectFile, composition);
  return editResult(json, projectFile, composition, clip, "moved");
}

async function rm(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, []);
  const { projectFile, composition, clipId } = await editable(positional, "rm");
  const clip = removeClip(composition, clipId);
  await writeJson(projectFile, composition);
  if (json) printJson({ ok: true, removed: clip, summary: summarizeComposition(composition, projectFile) });
  else process.stdout.write(`removed clip "${clip.id}"\n`);
  return 0;
}

async function set(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, []);
  const { projectFile, composition, clipId } = await editable(positional, "set");
  const pairs = positional.slice(3);
  if (pairs.length === 0) throw new VigoError("E_USAGE", "Usage: vigo set <project> <clip> key=value [...]");
  const patch: Record<string, string | number> = {};
  const numericKeys = new Set(["start", "duration", "offset", "volume", "fadeIn", "fadeOut", "opacity"]);
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new VigoError("E_USAGE", `Expected key=value, got "${pair}"`);
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    patch[key] = numericKeys.has(key) ? toNumber(raw) : raw;
  }
  const clip = setClip(composition, clipId, patch);
  await writeJson(projectFile, composition);
  return editResult(json, projectFile, composition, clip, "updated");
}

async function editable(
  positional: string[],
  command: string,
): Promise<{ projectFile: string; composition: Composition; clipId: string }> {
  const projectFile = path.resolve(
    required(positional[1], `Usage: vigo ${command} <project.json> <clipId> ...`),
  );
  const composition = await loadProject(projectFile);
  const clipId = required(positional[2], `${command} needs a clip id`);
  return { projectFile, composition, clipId };
}

function editResult(
  json: boolean,
  projectFile: string,
  composition: Composition,
  clip: { id: string; start: number; duration: number },
  verb: string,
): number {
  if (json) {
    printJson({ ok: true, clip, summary: summarizeComposition(composition, projectFile) });
  } else {
    process.stdout.write(
      `${verb} "${clip.id}" -> start ${clip.start}s, duration ${clip.duration}s\n`,
    );
  }
  return 0;
}

async function track(positional: string[], flags: Flags, json: boolean): Promise<number> {
  const action = positional[1];
  if (action === "add") {
    ensureFlags(flags, ["type", "id"]);
    const projectFile = path.resolve(required(positional[2], "Usage: vigo track add <project> --type html"));
    const composition = await loadProject(projectFile);
    const type = str(flags, "type") as TrackType | undefined;
    if (!type) throw new VigoError("E_USAGE", "track add needs --type html|media|audio");
    const added = addTrack(composition, type, str(flags, "id"));
    await writeJson(projectFile, composition);
    if (json) printJson({ ok: true, track: added, summary: summarizeComposition(composition, projectFile) });
    else process.stdout.write(`added ${type} track "${added.id}"\n`);
    return 0;
  }
  if (action === "rm" || action === "remove") {
    ensureFlags(flags, []);
    const projectFile = path.resolve(required(positional[2], "Usage: vigo track rm <project> <trackId>"));
    const composition = await loadProject(projectFile);
    const trackId = required(positional[3], "track rm needs a track id");
    const removed = removeTrack(composition, trackId);
    await writeJson(projectFile, composition);
    if (json) printJson({ ok: true, removed, summary: summarizeComposition(composition, projectFile) });
    else process.stdout.write(`removed track "${removed.id}" (${removed.clips.length} clips)\n`);
    return 0;
  }
  throw new VigoError("E_USAGE", "Usage: vigo track add|rm <project> ...");
}

async function inspect(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, []);
  const projectFile = path.resolve(required(positional[1], "Usage: vigo inspect <project.json>"));
  const composition = await loadProject(projectFile);
  const summary = summarizeComposition(composition, projectFile);
  if (json) {
    printJson({ ok: true, ...summary });
    return 0;
  }
  process.stdout.write(`${summary.name ?? "untitled"}  ${summary.width}x${summary.height} @ ${summary.fps}fps  ${summary.duration}s\n`);
  for (const track of summary.tracks) {
    process.stdout.write(`\n[${track.id}] ${track.type}\n`);
    if (track.clips.length === 0) process.stdout.write("  (empty)\n");
    for (const clip of track.clips) {
      const src = clip.src ? ` ${clip.src}` : "";
      process.stdout.write(`  ${clip.id}  ${clip.start}s..${clip.end}s (${clip.duration}s)${src}\n`);
    }
  }
  return 0;
}

async function check(positional: string[], flags: Flags, json: boolean): Promise<number> {
  ensureFlags(flags, []);
  const projectFile = path.resolve(required(positional[1], "Usage: vigo check <project.json>"));
  const composition = await loadProject(projectFile);
  const errors = validateComposition(composition);
  const files = await verifyProjectFiles(composition, projectFile);
  let chromium: string | null = null;
  try {
    chromium = findChromium();
  } catch (error) {
    files.push((error as Error).message);
  }
  const ffmpeg = await toolVersion("ffmpeg");
  if (!ffmpeg) files.push("ffmpeg not found on PATH");
  const problems = [...errors, ...files];
  const summary = summarizeComposition(composition, projectFile);
  if (json) {
    printJson({ ok: problems.length === 0, project: projectFile, errors: problems, summary, chromium, ffmpeg });
  } else {
    process.stdout.write(`${projectFile}\n${summary.duration}s, ${summary.tracks.length} tracks\n`);
    process.stdout.write(problems.length === 0 ? "ok: project is renderable\n" : `${problems.length} problem(s):\n`);
    for (const problem of problems) process.stdout.write(`  - ${problem}\n`);
  }
  return problems.length === 0 ? 0 : 1;
}

const isMain = process.argv[1] !== undefined
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
      process.exitCode = 1;
    });
}


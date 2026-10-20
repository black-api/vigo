import path from "node:path";
import os from "node:os";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VigoError } from "../errors.ts";
import { ensureDir, round } from "../util/fsx.ts";
import { ffmpeg, probeMedia } from "../media/ffmpeg.ts";
import {
  loadProject,
  normalizeComposition,
  projectDuration,
  validateComposition,
  verifyProjectFiles,
} from "../core/timeline.ts";
import type { AudioClip, Composition, HtmlClip, MediaClip, Track } from "../core/types.ts";
import { launchBrowser, loadScene, openScene, seekScene, captureFrame } from "./browser.ts";
import { encodeComposition, hexToFfmpegColor, type AudioLayer, type VisualLayer } from "./encode.ts";

export interface RenderProgress {
  phase: "prepare" | "frames" | "encode" | "done";
  frame: number;
  totalFrames: number;
  track?: string;
  percent: number;
}

export interface RenderOptions {
  output: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  crf?: number;
  preset?: string;
  framesDir?: string;
  keepFrames?: boolean;
  baseDir?: string;
  /** "jpeg" is faster but only works for a single opaque HTML layer. */
  frameFormat?: "png" | "jpeg";
  jpegQuality?: number;
  onProgress?: (progress: RenderProgress) => void;
}

export interface RenderResult {
  output: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  frames: number;
  htmlLayers: number;
  mediaClips: number;
  audioClips: number;
  elapsedMs: number;
  frameFormat: "png" | "jpeg";
  frameDir?: string;
}

export async function renderProject(projectFile: string, options: RenderOptions): Promise<RenderResult> {
  const composition = await loadProject(projectFile);
  return renderComposition(composition, options, path.dirname(projectFile));
}

function resolveSource(src: string, baseDir: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    throw new VigoError("E_REMOTE_SOURCE", `Remote sources are not supported yet: ${src}. Download it and use a local path.`);
  }
  if (src.startsWith("file://")) return fileURLToPath(src);
  return path.isAbsolute(src) ? src : path.resolve(baseDir, src);
}

function activeClip(track: Track, time: number): HtmlClip | null {
  for (const clip of track.clips) {
    if (clip.kind !== "html") continue;
    if (time + 1e-9 >= clip.start && time < clip.start + clip.duration - 1e-9) {
      return clip as HtmlClip;
    }
  }
  return null;
}

/**
 * Render a composition to a video file.
 *
 * Every HTML layer is captured frame by frame at a deterministic seek time;
 * media clips and audio are composited by a single ffmpeg graph afterwards.
 */
export async function renderComposition(
  composition: Composition,
  options: RenderOptions,
  baseDir = process.cwd(),
): Promise<RenderResult> {
  const started = Date.now();
  const comp = normalizeComposition({
    ...composition,
    ...(options.width !== undefined ? { width: options.width } : {}),
    ...(options.height !== undefined ? { height: options.height } : {}),
    ...(options.fps !== undefined ? { fps: options.fps } : {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
  });
  const errors = validateComposition(comp);
  if (errors.length > 0) {
    throw new VigoError("E_PROJECT_INVALID", `Invalid composition: ${errors.join("; ")}`, errors);
  }

  const duration = options.duration ?? projectDuration(comp);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VigoError("E_NOTHING_TO_RENDER", "Composition has no duration. Add a clip or set duration.");
  }
  const output = path.resolve(options.output);
  const outputExt = path.extname(output).toLowerCase();
  if (![".mp4", ".m4v", ".mov", ".mkv", ".webm"].includes(outputExt)) {
    throw new VigoError(
      "E_UNSUPPORTED",
      `Render output must be .mp4, .mov, .mkv, or .webm (got ${outputExt || "no extension"})`,
    );
  }
  await ensureDir(path.dirname(output));

  if (options.baseDir !== undefined) baseDir = options.baseDir;

  const fileProblems = await verifyEntries(comp, baseDir);
  if (fileProblems.length > 0) {
    throw new VigoError("E_SOURCE_MISSING", "Composition references missing files", fileProblems);
  }

  const fps = comp.fps;
  const frames = Math.max(1, Math.ceil(duration * fps - 1e-9));
  const htmlTracks = comp.tracks.filter((track) => track.type === "html" && track.clips.length > 0);
  const mediaTracks = comp.tracks.filter((track) => track.type === "media");
  const audioTracks = comp.tracks.filter((track) => track.type === "audio");
  const audioClips = audioTracks.flatMap((track) =>
    track.clips.map((clip) => ({ clip: clip as AudioClip, src: resolveSource((clip as AudioClip).src, baseDir) })),
  );

  const frameFormat = options.frameFormat ?? "png";
  const frameExt: "png" | "jpg" = frameFormat === "jpeg" ? "jpg" : "png";
  if (frameFormat === "jpeg" && (htmlTracks.length > 1 || mediaTracks.some((track) => track.clips.length > 0))) {
    throw new VigoError(
      "E_FRAME_FORMAT",
      "JPEG frames need transparency-free output: use a single HTML layer with no media clips, or frameFormat png.",
    );
  }

  const keepFrames = options.keepFrames ?? Boolean(options.framesDir);
  const root = options.framesDir
    ? path.resolve(options.framesDir)
    : await mkdtemp(path.join(os.tmpdir(), "vigo-frames-"));
  await ensureDir(root);

  const report = (progress: Omit<RenderProgress, "percent">) => {
    options.onProgress?.({
      ...progress,
      percent: progress.totalFrames > 0 ? round((progress.frame / progress.totalFrames) * 100, 1) : 0,
    });
  };

  let renderedFrames = 0;
  report({ phase: "prepare", frame: 0, totalFrames: frames });

  try {
    const layers: VisualLayer[] = [];

    if (htmlTracks.length > 0) {
      const blankPath = path.join(root, `blank.${frameExt}`);
      if (frameFormat === "jpeg") {
        await ffmpeg([
          "-f", "lavfi",
          "-i", `color=c=${hexToFfmpegColor(comp.background ?? "#000000")}:s=${comp.width}x${comp.height}:r=1`,
          "-frames:v", "1",
          "-q:v", "2",
          blankPath,
        ]);
      } else {
        await ffmpeg([
          "-f", "lavfi",
          "-i", `color=c=black@0.0:s=${comp.width}x${comp.height}:r=1,format=rgba`,
          "-frames:v", "1",
          "-pix_fmt", "rgba",
          blankPath,
        ]);
      }
      const blank = await readFile(blankPath);

      const browser = await launchBrowser();
      try {
        for (const [trackIndex, track] of htmlTracks.entries()) {
          const dir = path.join(root, `track-${trackIndex}-${track.id.replace(/[^a-z0-9_-]+/gi, "_")}`);
          await ensureDir(dir);
          // A reused frames dir must not leak frames from a previous, longer render.
          for (const name of await readdir(dir)) {
            if (/^frame-\d+\.(png|jpg)$/.test(name)) await rm(path.join(dir, name), { force: true });
          }
          const page = await openScene(browser, comp.width, comp.height);
          let loadedClipId: string | null = null;

          for (let frame = 0; frame < frames; frame += 1) {
            const time = frame / fps;
            const clip = activeClip(track, time);
            const framePath = path.join(dir, `frame-${String(frame).padStart(6, "0")}.${frameExt}`);
            if (!clip) {
              await writeFile(framePath, blank);
            } else {
              if (loadedClipId !== clip.id) {
                await loadScene(page, clip, baseDir);
                if (frameFormat === "jpeg") {
                  // Bake the composition background behind transparent HTML.
                  await page.evaluate((background) => {
                    document.documentElement.style.background = background;
                  }, comp.background ?? "#000000");
                }
                loadedClipId = clip.id;
              }
              const localTime = time - clip.start + (clip.offset ?? 0);
              await seekScene(page, Math.max(0, localTime));
              const image = await captureFrame(page, {
                width: comp.width,
                height: comp.height,
                transparent: frameFormat === "png",
                format: frameFormat,
                quality: options.jpegQuality ?? 94,
              });
              await writeFile(framePath, image);
            }
            renderedFrames += 1;
            report({ phase: "frames", frame: renderedFrames, totalFrames: frames * htmlTracks.length, track: track.id });
          }
          await page.close();
          layers.push({ kind: "frames", dir, ext: frameExt, ...(track.opacity !== undefined ? { opacity: track.opacity } : {}) });
        }
      } finally {
        await browser.close();
      }
    }

    for (const track of mediaTracks) {
      for (const clip of track.clips) {
        const media = clip as MediaClip;
        layers.push({
          kind: "media",
          clip: media,
          src: resolveSource(media.src, baseDir),
          opacity: (track.opacity ?? 1) * (media.opacity ?? 1),
        });
      }
    }

    // Preserve visual track stacking even when media tracks sit between HTML tracks.
    const orderedLayers = orderLayers(comp, layers);

    report({ phase: "encode", frame: 0, totalFrames: 0 });
    await encodeComposition({
      composition: comp,
      duration,
      layers: orderedLayers,
      audio: audioClips as AudioLayer[],
      output,
      crf: options.crf ?? 20,
      preset: options.preset ?? "medium",
    });

    if (!existsSync(output)) throw new VigoError("E_RENDER", `Render did not create ${output}`);
    const info = await probeMedia(output);
    report({ phase: "done", frame: 1, totalFrames: 1 });

    return {
      output,
      duration: round(info.duration || duration),
      width: comp.width,
      height: comp.height,
      fps,
      frames,
      htmlLayers: htmlTracks.length,
      mediaClips: mediaTracks.reduce((count, track) => count + track.clips.length, 0),
      audioClips: audioClips.length,
      elapsedMs: Date.now() - started,
      frameFormat,
      ...(keepFrames ? { frameDir: root } : {}),
    };
  } finally {
    if (!keepFrames) await rm(root, { recursive: true, force: true });
  }
}

/** Reorder visual layers to follow `comp.tracks` exactly. */
function orderLayers(comp: Composition, layers: VisualLayer[]): VisualLayer[] {
  const framesLayers = layers.filter((l): l is Extract<VisualLayer, { kind: "frames" }> => l.kind === "frames");
  const mediaLayers = layers.filter((l): l is Extract<VisualLayer, { kind: "media" }> => l.kind === "media");

  const result: VisualLayer[] = [];
  let htmlIndex = 0;
  let mediaIndex = 0;
  for (const track of comp.tracks) {
    if (track.type === "html" && track.clips.length > 0) {
      const layer = framesLayers[htmlIndex];
      if (layer) result.push(layer);
      htmlIndex += 1;
    } else if (track.type === "media") {
      for (let i = 0; i < track.clips.length; i += 1) {
        const layer = mediaLayers[mediaIndex];
        if (layer) result.push(layer);
        mediaIndex += 1;
      }
    }
  }
  // Any layer not matched (defensive) is appended rather than dropped.
  for (const layer of layers) if (!result.includes(layer)) result.push(layer);
  return result;
}

async function verifyEntries(comp: Composition, baseDir: string): Promise<string[]> {
  const missing: string[] = [];
  for (const track of comp.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === "html" && !(clip as HtmlClip).src) continue;
      const src = (clip as HtmlClip | MediaClip | AudioClip).src;
      if (!src) continue;
      if (src.startsWith("http://") || src.startsWith("https://")) {
        missing.push(`${clip.id}: remote sources must be downloaded first (${src})`);
        continue;
      }
      const resolved = resolveSource(src, baseDir);
      if (!existsSync(resolved)) missing.push(`${clip.id}: missing file ${resolved}`);
    }
  }
  return missing;
}

export interface HtmlToVideoOptions {
  html?: string;
  htmlPath?: string;
  output: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  background?: string;
  audio?: string;
  audioVolume?: number;
  audioStart?: number;
  fadeIn?: number;
  fadeOut?: number;
  crf?: number;
  preset?: string;
  frameFormat?: "png" | "jpeg";
  jpegQuality?: number;
  onProgress?: (progress: RenderProgress) => void;
}

export interface HtmlToVideoResult extends RenderResult {
  name: string;
}

/** One-call HTML scene → video, with optional audio bed. */
export async function htmlToVideo(options: HtmlToVideoOptions): Promise<HtmlToVideoResult> {
  if (!options.html && !options.htmlPath) {
    throw new VigoError("E_INVALID_INPUT", "Provide inline html or an htmlPath");
  }
  if (options.html && options.htmlPath) {
    throw new VigoError("E_INVALID_INPUT", "Provide either html or htmlPath, not both");
  }
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const fps = options.fps ?? 30;
  let duration = options.duration;
  if (duration === undefined) {
    duration = 5;
    if (options.audio) {
      const info = await probeMedia(options.audio);
      if (info.duration > 0) duration = round(info.duration);
    }
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VigoError("E_INVALID_INPUT", "duration must be > 0");
  }

  const name = options.htmlPath ? path.basename(options.htmlPath, path.extname(options.htmlPath)) : "html-video";
  const clip: HtmlClip = {
    id: "scene",
    kind: "html",
    start: 0,
    duration,
    ...(options.htmlPath ? { src: path.resolve(options.htmlPath) } : { html: options.html }),
  };

  const tracks: Track[] = [{ id: "main", type: "html", clips: [clip] }];
  if (options.audio) {
    tracks.push({
      id: "audio",
      type: "audio",
      clips: [
        {
          id: "audio-bed",
          kind: "audio",
          src: path.resolve(options.audio),
          start: options.audioStart ?? 0,
          duration,
          offset: 0,
          volume: options.audioVolume ?? 1,
          ...(options.fadeIn !== undefined ? { fadeIn: options.fadeIn } : {}),
          ...(options.fadeOut !== undefined ? { fadeOut: options.fadeOut } : {}),
        },
      ],
    });
  }

  const comp: Composition = {
    version: 1,
    name,
    width,
    height,
    fps,
    duration,
    background: options.background ?? "#000000",
    tracks,
  };

  const result = await renderComposition(comp, {
    output: options.output,
    crf: options.crf,
    preset: options.preset,
    frameFormat: options.frameFormat,
    jpegQuality: options.jpegQuality,
    onProgress: options.onProgress,
  });
  return { ...result, name };
}

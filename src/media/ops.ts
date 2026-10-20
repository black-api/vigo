import path from "node:path";
import { existsSync } from "node:fs";
import { ensureDir, round } from "../util/fsx.ts";
import { VigoError } from "../errors.ts";
import { ffmpeg, probeMedia, type MediaInfo } from "./ffmpeg.ts";

export const VIDEO_OUTPUT_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv", ".gif"]);
export const AUDIO_OUTPUT_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac"]);

export interface ConvertOptions {
  output: string;
  start?: number;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  crf?: number;
  preset?: string;
  keepAudio?: boolean;
}

export interface ConvertResult {
  input: string;
  output: string;
  duration: number;
  width?: number;
  height?: number;
  size: number;
}

function assertInput(file: string): void {
  if (!existsSync(file)) throw new VigoError("E_FILE_NOT_FOUND", `Input not found: ${file}`);
}

function codecArgs(ext: string, crf: number, preset: string): string[] {
  if (ext === ".webm") {
    return [
      "-c:v", "libvpx-vp9",
      "-b:v", "0",
      "-crf", String(crf),
      "-row-mt", "1",
      "-c:a", "libopus",
      "-b:a", "128k",
    ];
  }
  return [
    "-c:v", "libx264",
    "-preset", preset,
    "-crf", String(crf),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    ...(ext === ".mp4" || ext === ".m4v" || ext === ".mov" ? ["-movflags", "+faststart"] : []),
  ];
}

function audioCodecArgs(ext: string): string[] {
  switch (ext) {
    case ".mp3":
      return ["-c:a", "libmp3lame", "-q:a", "2"];
    case ".wav":
      return ["-c:a", "pcm_s16le"];
    case ".m4a":
    case ".aac":
      return ["-c:a", "aac", "-b:a", "192k"];
    case ".ogg":
      return ["-c:a", "libvorbis", "-q:a", "5"];
    case ".opus":
      return ["-c:a", "libopus", "-b:a", "128k"];
    case ".flac":
      return ["-c:a", "flac"];
    default:
      throw new VigoError("E_UNSUPPORTED", `Unsupported audio output extension "${ext}"`);
  }
}

function scaleFilter(options: ConvertOptions): string | null {
  if (options.width && options.height) {
    return `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
  }
  if (options.width) return `scale=${options.width}:-2:flags=lanczos`;
  if (options.height) return `scale=-2:${options.height}:flags=lanczos`;
  return null;
}

/** Convert any media file to mp4/webm/gif/mp3/wav/... in one call. */
export async function convertMedia(input: string, options: ConvertOptions): Promise<ConvertResult> {
  assertInput(input);
  const output = path.resolve(options.output);
  const ext = path.extname(output).toLowerCase();
  const isVideo = VIDEO_OUTPUT_EXTENSIONS.has(ext);
  const isAudio = AUDIO_OUTPUT_EXTENSIONS.has(ext);
  if (!isVideo && !isAudio) {
    throw new VigoError(
      "E_UNSUPPORTED",
      `Unsupported output format "${ext}". Use ${[...VIDEO_OUTPUT_EXTENSIONS, ...AUDIO_OUTPUT_EXTENSIONS].join(", ")}`,
    );
  }
  if (path.resolve(input) === output) {
    throw new VigoError("E_INVALID_OUTPUT", "Output must be different from input");
  }
  await ensureDir(path.dirname(output));

  const args: string[] = [];
  if (options.start !== undefined && options.start > 0) args.push("-ss", String(options.start));
  args.push("-i", input);
  if (options.duration !== undefined) args.push("-t", String(options.duration));

  const crf = options.crf ?? (ext === ".webm" ? 32 : 20);
  const preset = options.preset ?? "medium";
  const fpsFilter = options.fps ? `fps=${options.fps}` : null;
  const scale = scaleFilter(options);
  const filters = [fpsFilter, scale].filter(Boolean).join(",");

  if (ext === ".gif") {
    const gifFps = options.fps ?? 12;
    const gifWidth = options.width ?? 640;
    const palette = `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`;
    args.push("-filter_complex", palette, "-loop", "0", "-an");
  } else if (isAudio) {
    args.push("-vn", ...audioCodecArgs(ext));
  } else {
    if (filters) args.push("-vf", filters);
    if (options.keepAudio === false) args.push("-an");
    args.push(...codecArgs(ext, crf, preset));
  }

  if (options.start !== undefined || options.duration !== undefined) {
    // -ss before -i is fast and frame-accurate enough for conversions.
  }

  args.push(output);
  await ffmpeg(args);
  if (!existsSync(output)) throw new VigoError("E_FFMPEG", `ffmpeg did not create ${output}`);

  const info = await probeMedia(output);
  return {
    input,
    output,
    duration: round(info.duration),
    ...(info.video ? { width: info.video.width, height: info.video.height } : {}),
    size: info.size,
  };
}

export interface ConcatOptions {
  inputs: string[];
  output: string;
  width?: number;
  height?: number;
  fps?: number;
  crf?: number;
  preset?: string;
}

/**
 * Concatenate clips even when resolutions/framerates differ.
 * Missing audio tracks are filled with silence so the result always has audio.
 */
export async function concatMedia(options: ConcatOptions): Promise<ConvertResult> {
  if (options.inputs.length < 1) throw new VigoError("E_INVALID_INPUT", "concat needs at least one input");
  for (const file of options.inputs) assertInput(file);
  const output = path.resolve(options.output);
  if (options.inputs.some((file) => path.resolve(file) === output)) {
    throw new VigoError("E_INVALID_OUTPUT", "Output must be different from every input");
  }
  const outputExt = path.extname(output).toLowerCase();
  if (![".mp4", ".m4v", ".mov", ".mkv", ".webm"].includes(outputExt)) {
    throw new VigoError("E_UNSUPPORTED", `Concat output must be .mp4, .mov, .mkv, or .webm (got ${outputExt || "none"})`);
  }
  await ensureDir(path.dirname(output));

  const infos: MediaInfo[] = [];
  for (const file of options.inputs) infos.push(await probeMedia(file));
  const firstVideo = infos.find((info) => info.video)?.video;
  const width = options.width ?? firstVideo?.width ?? 1920;
  const height = options.height ?? firstVideo?.height ?? 1080;
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new VigoError("E_INVALID_INPUT", "concat width and height must be even");
  }
  const fps = options.fps ?? round(firstVideo?.fps ?? 30, 3);

  const args: string[] = [];
  const inputIndexes: Array<{ video: number; audio: number | null }> = [];
  let inputCount = 0;

  for (const [i, info] of infos.entries()) {
    if (!info.video) throw new VigoError("E_INVALID_INPUT", `Input ${i} has no video stream: ${options.inputs[i]}`);
    args.push("-i", options.inputs[i] as string);
    const videoIndex = inputCount;
    inputCount += 1;
    let audioIndex: number | null = info.audio ? videoIndex : null;
    if (!info.audio) {
      args.push("-f", "lavfi", "-t", String(Math.max(info.duration, 0.1)), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
      audioIndex = inputCount;
      inputCount += 1;
    }
    inputIndexes.push({ video: videoIndex, audio: audioIndex });
  }

  const filter: string[] = [];
  const concatLabels: string[] = [];
  for (const [i, indexes] of inputIndexes.entries()) {
    filter.push(
      `[${indexes.video}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${i}]`,
    );
    filter.push(
      `[${indexes.audio}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`,
    );
    concatLabels.push(`[v${i}][a${i}]`);
  }
  filter.push(`${concatLabels.join("")}concat=n=${inputIndexes.length}:v=1:a=1[vout][aout]`);

  args.push(
    "-filter_complex", filter.join(";"),
    "-map", "[vout]",
    "-map", "[aout]",
    ...codecArgs(outputExt === ".webm" ? ".webm" : outputExt === ".mkv" ? ".mkv" : ".mp4", options.crf ?? 20, options.preset ?? "medium"),
    output,
  );

  await ffmpeg(args);
  const info = await probeMedia(output);
  return {
    input: options.inputs.join(","),
    output,
    duration: round(info.duration),
    ...(info.video ? { width: info.video.width, height: info.video.height } : {}),
    size: info.size,
  };
}

export interface ThumbnailOptions {
  output: string;
  at?: number;
  width?: number;
}

export async function thumbnail(input: string, options: ThumbnailOptions): Promise<ConvertResult> {
  assertInput(input);
  const output = path.resolve(options.output);
  await ensureDir(path.dirname(output));
  const filters = options.width ? `scale=${options.width}:-2:flags=lanczos` : "scale=iw:ih";
  await ffmpeg([
    "-ss", String(options.at ?? 0),
    "-i", input,
    "-frames:v", "1",
    "-vf", filters,
    "-q:v", "2",
    output,
  ]);
  const info = await probeMedia(output);
  return {
    input,
    output,
    duration: 0,
    ...(info.video ? { width: info.video.width, height: info.video.height } : {}),
    size: info.size,
  };
}

export interface ExtractFramesOptions {
  outputDir: string;
  fps?: number;
  start?: number;
  duration?: number;
  width?: number;
  format?: "png" | "jpg";
}

export async function extractFrames(input: string, options: ExtractFramesOptions): Promise<{ outputDir: string; pattern: string; count: number }> {
  assertInput(input);
  const dir = path.resolve(options.outputDir);
  await ensureDir(dir);
  const format = options.format ?? "png";
  const pattern = path.join(dir, `frame-%06d.${format}`);
  const filters = [`fps=${options.fps ?? 1}`];
  if (options.width) filters.push(`scale=${options.width}:-2:flags=lanczos`);
  const args: string[] = [];
  if (options.start !== undefined && options.start > 0) args.push("-ss", String(options.start));
  if (options.duration !== undefined) args.push("-t", String(options.duration));
  args.push(
    "-i", input,
    "-vf", filters.join(","),
    "-start_number", "1",
    ...(format === "jpg" ? ["-q:v", "2"] : []),
    pattern,
  );
  await ffmpeg(args);
  const { readdir } = await import("node:fs/promises");
  const count = (await readdir(dir)).filter((name) => name.startsWith("frame-")).length;
  return { outputDir: dir, pattern, count };
}

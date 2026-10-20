import path from "node:path";
import { VigoError } from "../errors.ts";
import { ffmpeg } from "../media/ffmpeg.ts";
import { round } from "../util/fsx.ts";
import type { AudioClip, Composition, MediaClip } from "../core/types.ts";

export interface FramesLayer {
  kind: "frames";
  /** Directory with frame-%06d.<ext> files. */
  dir: string;
  ext?: "png" | "jpg";
  opacity?: number;
}

export interface MediaLayer {
  kind: "media";
  clip: MediaClip;
  src: string;
  opacity?: number;
}

export type VisualLayer = FramesLayer | MediaLayer;

export interface AudioLayer {
  clip: AudioClip;
  src: string;
}

export interface EncodeOptions {
  composition: Composition;
  duration: number;
  layers: VisualLayer[];
  audio: AudioLayer[];
  output: string;
  crf: number;
  preset: string;
}

export function hexToFfmpegColor(color: string): string {
  const value = color.trim();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [r, g, b] = value.slice(1).split("");
    return `0x${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return `0x${value.slice(1)}`;
  if (/^#[0-9a-f]{8}$/i.test(value)) return `0x${value.slice(1, 7)}`;
  return value;
}

export function codecArgsFor(output: string, crf: number, preset: string): string[] {
  const ext = path.extname(output).toLowerCase();
  if (ext === ".webm") {
    return [
      "-c:v", "libvpx-vp9",
      "-b:v", "0",
      "-crf", String(crf),
      "-row-mt", "1",
      "-c:a", "libopus",
      "-b:a", "160k",
    ];
  }
  if (ext === ".mp4" || ext === ".m4v" || ext === ".mov" || ext === ".mkv") {
    return [
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      ...(ext === ".mkv" ? [] : ["-movflags", "+faststart"]),
    ];
  }
  throw new VigoError(
    "E_UNSUPPORTED",
    `Render output must be .mp4, .mov, .mkv, or .webm (got ${ext || "no extension"})`,
  );
}

function scaleFilter(clip: MediaClip, width: number, height: number): string {
  const fit = clip.fit ?? "contain";
  if (fit === "cover") {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`;
  }
  if (fit === "fill") return `scale=${width}:${height}:flags=lanczos`;
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
  );
}

function applyOpacity(filter: string, opacity: number | undefined): string {
  if (opacity === undefined || opacity >= 1) return filter;
  const clamped = Math.max(0, Math.min(1, opacity));
  return `${filter},colorchannelmixer=aa=${clamped}`;
}

/**
 * Build and run one ffmpeg graph:
 *   color background -> HTML layers -> media clips -> mixed audio
 *
 * HTML layers arrive as pre-rendered transparent PNG sequences, which keeps
 * compositing deterministic and avoids needing a video codec per layer.
 */
export async function encodeComposition(options: EncodeOptions): Promise<void> {
  const { composition: comp, duration, layers, audio } = options;
  const width = comp.width;
  const height = comp.height;
  const fps = comp.fps;
  const background = hexToFfmpegColor(comp.background ?? "#000000");

  const args: string[] = [
    "-f", "lavfi",
    "-i", `color=c=${background}:s=${width}x${height}:r=${fps}:d=${round(duration, 3)}`,
  ];
  let inputCount = 1;

  const filter: string[] = [];
  filter.push(`[0:v]format=rgba,setpts=PTS-STARTPTS[base]`);
  let lastVideo = "base";

  for (const [index, layer] of layers.entries()) {
    const label = `l${index}`;
    if (layer.kind === "frames") {
      args.push(
        "-framerate", String(fps),
        "-start_number", "0",
        "-i", path.join(layer.dir, `frame-%06d.${layer.ext ?? "png"}`),
      );
      const input = inputCount;
      inputCount += 1;
      filter.push(`[${input}:v]${applyOpacity("format=rgba", layer.opacity)}[${label}]`);
    } else {
      const clip = layer.clip;
      const source = layer.src;
      if (clip.kind === "image") {
        args.push(
          "-loop", "1",
          "-framerate", String(fps),
          "-t", String(round(clip.duration + (clip.offset ?? 0) + 0.1, 3)),
          "-i", source,
        );
      } else {
        const offset = clip.offset ?? 0;
        if (offset > 0) args.push("-ss", String(offset));
        args.push("-t", String(round(clip.duration + 0.1, 3)), "-i", source);
      }
      const input = inputCount;
      inputCount += 1;
      const mediaFilter = applyOpacity(
        `${scaleFilter(clip, width, height)},setsar=1,fps=${fps},format=rgba,setpts=PTS-STARTPTS+${round(clip.start, 3)}/TB`,
        layer.opacity,
      );
      filter.push(`[${input}:v]${mediaFilter}[${label}]`);
    }
    const next = `v${index}`;
    filter.push(`[${lastVideo}][${label}]overlay=0:0:format=auto:eof_action=pass:shortest=0[${next}]`);
    lastVideo = next;
  }

  let audioLabel: string | null = null;
  if (audio.length > 0) {
    const audioLabels: string[] = [];
    for (const [index, item] of audio.entries()) {
      const clip = item.clip;
      args.push("-i", item.src);
      const input = inputCount;
      inputCount += 1;
      const volume = clip.volume ?? 1;
      const parts = [
        "aresample=48000",
        "aformat=sample_fmts=fltp:channel_layouts=stereo",
        `atrim=start=${round(clip.offset ?? 0, 3)}:duration=${round(clip.duration, 3)}`,
        "asetpts=PTS-STARTPTS",
        `volume=${volume}`,
      ];
      if (clip.fadeIn && clip.fadeIn > 0) {
        parts.push(`afade=t=in:st=0:d=${round(Math.min(clip.fadeIn, clip.duration), 3)}`);
      }
      if (clip.fadeOut && clip.fadeOut > 0) {
        const start = Math.max(0, clip.duration - Math.min(clip.fadeOut, clip.duration));
        parts.push(`afade=t=out:st=${round(start, 3)}:d=${round(Math.min(clip.fadeOut, clip.duration), 3)}`);
      }
      const delayMs = Math.round(Math.max(0, clip.start) * 1000);
      parts.push(`adelay=delays=${delayMs}:all=1`);
      const audioTag = `a${index}`;
      filter.push(`[${input}:a]${parts.join(",")}[${audioTag}]`);
      audioLabels.push(`[${audioTag}]`);
    }
    let mixed: string;
    if (audioLabels.length === 1) {
      mixed = audioLabels[0] as string;
    } else {
      filter.push(
        `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[amixed]`,
      );
      mixed = "[amixed]";
    }
    // Normalize timestamps BEFORE the final trim. Trimming first and then
    // resetting PTS makes ffmpeg drop the leading silence (and audio length).
    filter.push(
      `${mixed}apad=pad_dur=${round(duration, 3)},asetpts=PTS-STARTPTS,atrim=duration=${round(duration, 3)}[aout]`,
    );
    audioLabel = "aout";
  }

  // Delivered video is always opaque; VP9 specifically rejects rgba/gbrap.
  filter.push(`[${lastVideo}]format=yuv420p[vout]`);

  const maps = ["-map", "[vout]"];
  if (audioLabel) maps.push("-map", `[${audioLabel}]`);
  else maps.push("-an");

  args.push(
    "-filter_complex", filter.join(";"),
    ...maps,
    "-t", String(round(duration, 3)),
    "-r", String(fps),
    ...codecArgsFor(options.output, options.crf, options.preset),
    options.output,
  );

  if (process.env.VIGO_DEBUG) {
    console.error(`[vigo] ffmpeg ${args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`);
  }
  await ffmpeg(args);
}

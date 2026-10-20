/**
 * vigo's entire video model is a small JSON composition.
 *
 * A composition is a stack of tracks. Visual tracks are composited bottom to
 * top in array order; audio tracks are mixed together. Every clip is placed on
 * the timeline with `start` + `duration` seconds and can trim into its source
 * with `offset`.
 *
 * Timing: a clip is active while `start <= t < start + duration`.
 * Source local time: `t - start + offset`.
 */

export type TrackType = "html" | "media" | "audio";
export type ClipKind = "html" | "video" | "image" | "audio";
export type Fit = "contain" | "cover" | "fill";

export interface ClipBase {
  id: string;
  kind: ClipKind;
  /** Seconds on the timeline. */
  start: number;
  /** Seconds on the timeline. Must be > 0. */
  duration: number;
  /** Seconds trimmed from the start of the source. */
  offset?: number;
  label?: string;
}

/** An HTML scene, rendered frame-by-frame in headless Chromium. */
export interface HtmlClip extends ClipBase {
  kind: "html";
  /** Path to an HTML file, relative to the project file. */
  src?: string;
  /** Inline HTML, for tiny scenes. Inline scenes cannot use relative assets. */
  html?: string;
  /** Optional CSS background applied to the scene document. */
  background?: string;
}

export interface MediaClip extends ClipBase {
  kind: "video" | "image";
  src: string;
  fit?: Fit;
  opacity?: number;
}

export interface AudioClip extends ClipBase {
  kind: "audio";
  src: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export type Clip = HtmlClip | MediaClip | AudioClip;

export interface Track {
  id: string;
  type: TrackType;
  label?: string;
  /** Layer opacity for visual tracks, 0..1. */
  opacity?: number;
  clips: Clip[];
}

export interface Composition {
  version: 1;
  name?: string;
  width: number;
  height: number;
  fps: number;
  /** Optional explicit length. Defaults to the end of the last clip. */
  duration?: number;
  background?: string;
  tracks: Track[];
}

export interface AddClipInput {
  id?: string;
  kind?: ClipKind;
  start?: number;
  duration?: number;
  offset?: number;
  label?: string;
  src?: string;
  html?: string;
  background?: string;
  fit?: Fit;
  opacity?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface ClipPatch {
  start?: number;
  duration?: number;
  offset?: number;
  label?: string;
  src?: string;
  html?: string;
  background?: string;
  fit?: Fit;
  opacity?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface CompositionSummary {
  path?: string;
  name?: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  background?: string;
  tracks: Array<{
    id: string;
    type: TrackType;
    clips: Array<{
      id: string;
      kind: ClipKind;
      start: number;
      duration: number;
      end: number;
      src?: string;
    }>;
  }>;
}

export const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".ogv",
]);
export const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
]);
export const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".flac",
]);

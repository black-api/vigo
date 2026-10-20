import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { VigoError } from "../errors.ts";
import { readJson, slugify, uniqueId, writeJson } from "../util/fsx.ts";
import type {
  AddClipInput,
  AudioClip,
  Clip,
  ClipKind,
  ClipPatch,
  Composition,
  CompositionSummary,
  HtmlClip,
  MediaClip,
  Track,
  TrackType,
} from "./types.ts";
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "./types.ts";

const EPSILON = 1e-6;

export const DEFAULT_COMPOSITION = {
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#0b0d12",
} as const;

export function createComposition(
  options: Partial<Pick<Composition, "name" | "width" | "height" | "fps" | "duration" | "background">> = {},
): Composition {
  return {
    version: 1,
    name: options.name ?? "untitled",
    width: options.width ?? DEFAULT_COMPOSITION.width,
    height: options.height ?? DEFAULT_COMPOSITION.height,
    fps: options.fps ?? DEFAULT_COMPOSITION.fps,
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    background: options.background ?? DEFAULT_COMPOSITION.background,
    tracks: [
      { id: "main", type: "html", clips: [] },
      { id: "audio", type: "audio", clips: [] },
    ],
  };
}

/** Validate, then write a project atomically. */
export async function saveProject(file: string, composition: Composition): Promise<void> {
  const errors = validateComposition(composition);
  if (errors.length > 0) throw new VigoError("E_PROJECT_INVALID", `Invalid project ${file}: ${errors.join("; ")}`, errors);
  await writeJson(file, composition);
}

export async function loadProject(file: string): Promise<Composition> {
  let raw: unknown;
  try {
    raw = await readJson<unknown>(file);
  } catch (error) {
    throw new VigoError("E_PROJECT_READ", `Cannot read project ${file}: ${(error as Error).message}`);
  }
  const composition = normalizeComposition(raw);
  const errors = validateComposition(composition);
  if (errors.length > 0) {
    throw new VigoError("E_PROJECT_INVALID", `Invalid project ${file}: ${errors.join("; ")}`, errors);
  }
  return composition;
}

/**
 * Accept a hand-written or agent-written timeline and fill in safe defaults.
 * Structural problems are reported by validateComposition, not thrown here.
 */
export function normalizeComposition(raw: unknown): Composition {
  if (!raw || typeof raw !== "object") {
    throw new VigoError("E_PROJECT_INVALID", "Project must be a JSON object");
  }
  const input = raw as Record<string, unknown>;
  const tracksInput = Array.isArray(input.tracks) ? input.tracks : [];
  const tracks: Track[] = tracksInput.map((trackRaw, trackIndex) => {
    const t = (trackRaw ?? {}) as Record<string, unknown>;
    const clipsInput = Array.isArray(t.clips) ? t.clips : [];
    const type = (t.type ?? "html") as TrackType;
    const clips: Clip[] = clipsInput.map((clipRaw, clipIndex) => {
      const c = (clipRaw ?? {}) as Record<string, unknown>;
      const kind = (c.kind ?? (type === "audio" ? "audio" : type === "media" ? "video" : "html")) as ClipKind;
      const base = {
        id: typeof c.id === "string" && c.id ? c.id : `clip-${trackIndex + 1}-${clipIndex + 1}`,
        kind,
        start: numberOr(c.start, 0),
        duration: numberOr(c.duration, 1),
        ...(c.offset !== undefined ? { offset: numberOr(c.offset, 0) } : {}),
        ...(typeof c.label === "string" ? { label: c.label } : {}),
      };
      if (kind === "html") {
        return {
          ...base,
          kind: "html",
          ...(typeof c.src === "string" ? { src: c.src } : {}),
          ...(typeof c.html === "string" ? { html: c.html } : {}),
          ...(typeof c.background === "string" ? { background: c.background } : {}),
        } satisfies HtmlClip;
      }
      if (kind === "audio") {
        return {
          ...base,
          kind: "audio",
          src: typeof c.src === "string" ? c.src : "",
          ...(c.volume !== undefined ? { volume: numberOr(c.volume, 1) } : {}),
          ...(c.fadeIn !== undefined ? { fadeIn: numberOr(c.fadeIn, 0) } : {}),
          ...(c.fadeOut !== undefined ? { fadeOut: numberOr(c.fadeOut, 0) } : {}),
        } satisfies AudioClip;
      }
      return {
        ...base,
        kind: kind === "image" ? "image" : "video",
        src: typeof c.src === "string" ? c.src : "",
        ...(typeof c.fit === "string" ? { fit: c.fit as MediaClip["fit"] } : {}),
        ...(c.opacity !== undefined ? { opacity: numberOr(c.opacity, 1) } : {}),
      } satisfies MediaClip;
    });
    return {
      id: typeof t.id === "string" && t.id ? t.id : `track-${trackIndex + 1}`,
      type,
      ...(typeof t.label === "string" ? { label: t.label } : {}),
      ...(t.opacity !== undefined ? { opacity: numberOr(t.opacity, 1) } : {}),
      clips,
    };
  });

  return {
    version: 1,
    ...(typeof input.name === "string" ? { name: input.name } : {}),
    width: numberOr(input.width, DEFAULT_COMPOSITION.width),
    height: numberOr(input.height, DEFAULT_COMPOSITION.height),
    fps: numberOr(input.fps, DEFAULT_COMPOSITION.fps),
    ...(input.duration !== undefined ? { duration: numberOr(input.duration, 0) } : {}),
    ...(typeof input.background === "string" ? { background: input.background } : { background: DEFAULT_COMPOSITION.background }),
    tracks,
  };
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

export function validateComposition(comp: Composition): string[] {
  const errors: string[] = [];
  if (!comp || typeof comp !== "object") return ["Project must be an object"];
  if (comp.version !== 1) errors.push("version must be 1");
  if (!Number.isFinite(comp.width) || comp.width <= 0) errors.push("width must be > 0");
  else if (comp.width % 2 !== 0) errors.push("width must be even (H.264/yuv420p requirement)");
  if (!Number.isFinite(comp.height) || comp.height <= 0) errors.push("height must be > 0");
  else if (comp.height % 2 !== 0) errors.push("height must be even (H.264/yuv420p requirement)");
  if (!Number.isFinite(comp.fps) || comp.fps <= 0 || comp.fps > 120) errors.push("fps must be between 0 and 120");
  if (comp.duration !== undefined && (!Number.isFinite(comp.duration) || comp.duration <= 0)) {
    errors.push("duration must be > 0 when set");
  }
  if (!Array.isArray(comp.tracks)) {
    errors.push("tracks must be an array");
    return errors;
  }
  if (comp.tracks.length > 32) errors.push("too many tracks (max 32)");

  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  const visualTrackTypes = new Set<TrackType>(["html", "media"]);

  comp.tracks.forEach((track, ti) => {
    const where = `tracks[${ti}]`;
    if (!track.id) errors.push(`${where}.id is required`);
    else if (trackIds.has(track.id)) errors.push(`duplicate track id "${track.id}"`);
    trackIds.add(track.id);
    if (!["html", "media", "audio"].includes(track.type)) {
      errors.push(`${where}.type must be html, media, or audio`);
    }
    if (track.opacity !== undefined && (!Number.isFinite(track.opacity) || track.opacity < 0 || track.opacity > 1)) {
      errors.push(`${where}.opacity must be between 0 and 1`);
    }
    if (!Array.isArray(track.clips)) {
      errors.push(`${where}.clips must be an array`);
      return;
    }
    const ordered = [...track.clips].sort((a, b) => a.start - b.start);
    let previousEnd = -Infinity;
    let previousId = "";

    ordered.forEach((clip, ci) => {
      const at = `${where}.clips[${ci}]`;
      if (!clip.id) errors.push(`${at}.id is required`);
      else if (clipIds.has(clip.id)) errors.push(`duplicate clip id "${clip.id}"`);
      clipIds.add(clip.id);
      if (!Number.isFinite(clip.start) || clip.start < 0) errors.push(`${at}.start must be >= 0`);
      if (!Number.isFinite(clip.duration) || clip.duration <= 0) errors.push(`${at}.duration must be > 0`);
      if (clip.offset !== undefined && (!Number.isFinite(clip.offset) || clip.offset < 0)) {
        errors.push(`${at}.offset must be >= 0`);
      }
      if (track.type === "html" && clip.kind !== "html") errors.push(`${at}: html track can only hold html clips`);
      if (track.type === "media" && clip.kind !== "video" && clip.kind !== "image") {
        errors.push(`${at}: media track can only hold video/image clips`);
      }
      if (track.type === "audio" && clip.kind !== "audio") errors.push(`${at}: audio track can only hold audio clips`);
      if (clip.kind === "html") {
        const html = clip as HtmlClip;
        if (!html.src && !html.html) errors.push(`${at}: html clip requires "src" or "html"`);
        if (html.src && html.html) errors.push(`${at}: use either "src" or "html", not both`);
      } else if (!clip.src) {
        errors.push(`${at}: ${clip.kind} clip requires "src"`);
      }
      if (clip.kind === "video" || clip.kind === "image") {
        const media = clip as MediaClip;
        if (media.fit !== undefined && !["contain", "cover", "fill"].includes(media.fit)) {
          errors.push(`${at}.fit must be contain, cover, or fill`);
        }
        if (media.opacity !== undefined && (!Number.isFinite(media.opacity) || media.opacity < 0 || media.opacity > 1)) {
          errors.push(`${at}.opacity must be between 0 and 1`);
        }
      }
      if (clip.kind === "audio") {
        const audio = clip as AudioClip;
        if (audio.volume !== undefined && (!Number.isFinite(audio.volume) || audio.volume < 0 || audio.volume > 8)) {
          errors.push(`${at}.volume must be between 0 and 8`);
        }
        for (const key of ["fadeIn", "fadeOut"] as const) {
          const value = audio[key];
          if (value !== undefined && (!Number.isFinite(value) || value < 0)) errors.push(`${at}.${key} must be >= 0`);
        }
      }
      if (clip.start < previousEnd - EPSILON) {
        errors.push(`${at} overlaps "${previousId}" in track "${track.id}" (clips in one track cannot overlap)`);
      }
      previousEnd = Math.max(previousEnd, clip.start + clip.duration);
      previousId = clip.id;
    });

    if (track.type === "audio") {
      // Audio has no visual stack; ordering is free, but keep sorting predictable on save.
    } else if (!visualTrackTypes.has(track.type)) {
      errors.push(`${where}.type "${track.type}" is not visual`);
    }
  });

  return errors;
}

export function projectDuration(comp: Composition): number {
  if (Number.isFinite(comp.duration)) return Math.max(0, comp.duration as number);
  let end = 0;
  for (const track of comp.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  }
  return end;
}

export function findClip(comp: Composition, clipId: string): { track: Track; clip: Clip; index: number } {
  for (const track of comp.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index] as Clip, index };
  }
  throw new VigoError("E_CLIP_NOT_FOUND", `No clip with id "${clipId}"`);
}

export function findTrack(comp: Composition, trackId: string): Track {
  const track = comp.tracks.find((t) => t.id === trackId);
  if (!track) throw new VigoError("E_TRACK_NOT_FOUND", `No track with id "${trackId}"`);
  return track;
}

/** Total length of the clips on one track. */
export function trackEnd(track: Track): number {
  return track.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
}

export function inferClipKind(src: string, trackType: TrackType): ClipKind {
  const ext = path.extname(src).toLowerCase();
  if (trackType === "audio") return "audio";
  if (trackType === "media") {
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
    if (VIDEO_EXTENSIONS.has(ext)) return "video";
    return "video";
  }
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "html";
}

export function addClip(comp: Composition, trackId: string, input: AddClipInput): Clip {
  const track = findTrack(comp, trackId);
  const kind = input.kind ?? inferClipKind(input.src ?? "scene.html", track.type);
  if (track.type === "html" && kind !== "html") {
    throw new VigoError("E_TRACK_MISMATCH", `Track "${trackId}" holds html clips, got "${kind}"`);
  }
  if (track.type === "media" && kind !== "video" && kind !== "image") {
    throw new VigoError("E_TRACK_MISMATCH", `Track "${trackId}" holds video/image clips, got "${kind}"`);
  }
  if (track.type === "audio" && kind !== "audio") {
    throw new VigoError("E_TRACK_MISMATCH", `Track "${trackId}" holds audio clips, got "${kind}"`);
  }
  if (kind === "html" && !input.src && !input.html) {
    throw new VigoError("E_CLIP_INVALID", "An html clip needs src or html");
  }
  if (kind !== "html" && !input.src) {
    throw new VigoError("E_CLIP_INVALID", `A ${kind} clip needs src`);
  }
  if (input.src && input.html) {
    throw new VigoError("E_CLIP_INVALID", "Use either src or html, not both");
  }

  const start = input.start ?? trackEnd(track);
  const duration = input.duration ?? 5;
  if (!Number.isFinite(start) || start < 0) throw new VigoError("E_CLIP_INVALID", "start must be >= 0");
  if (!Number.isFinite(duration) || duration <= 0) throw new VigoError("E_CLIP_INVALID", "duration must be > 0");

  const sourceName = input.src ? path.basename(input.src) : "clip";
  const idBase = input.id ? slugify(input.id, "clip") : slugify(input.label ?? sourceName, "clip");
  const allClipIds = comp.tracks.flatMap((candidate) => candidate.clips.map((c) => c.id));
  const id = uniqueId(input.id ?? idBase, allClipIds);
  const common = {
    id,
    kind,
    start,
    duration,
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
  };

  let clip: Clip;
  if (kind === "html") {
    clip = {
      ...common,
      kind: "html",
      ...(input.src ? { src: input.src } : {}),
      ...(input.html ? { html: input.html } : {}),
      ...(input.background ? { background: input.background } : {}),
    };
  } else if (kind === "audio") {
    clip = {
      ...common,
      kind: "audio",
      src: input.src as string,
      volume: input.volume ?? 1,
      ...(input.fadeIn !== undefined ? { fadeIn: input.fadeIn } : {}),
      ...(input.fadeOut !== undefined ? { fadeOut: input.fadeOut } : {}),
    };
  } else {
    clip = {
      ...common,
      kind,
      src: input.src as string,
      fit: input.fit ?? "contain",
      ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
    };
  }

  assertPlacement(track, clip);
  track.clips.push(clip);
  sortClips(track);
  return clip;
}

function assertPlacement(track: Track, clip: Clip, ignoreId?: string): void {
  for (const other of track.clips) {
    if (other.id === ignoreId) continue;
    const overlaps = clip.start < other.start + other.duration - EPSILON
      && other.start < clip.start + clip.duration - EPSILON;
    if (overlaps) {
      throw new VigoError(
        "E_CLIP_OVERLAP",
        `Clip "${clip.id}" (${clip.start}s + ${clip.duration}s) overlaps "${other.id}" on track "${track.id}". Use another track for layering.`,
      );
    }
  }
}

export function sortClips(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start);
}

export function removeClip(comp: Composition, clipId: string): Clip {
  const { track, index } = findClip(comp, clipId);
  return track.clips.splice(index, 1)[0] as Clip;
}

export function moveClip(comp: Composition, clipId: string, start: number): Clip {
  if (!Number.isFinite(start) || start < 0) throw new VigoError("E_CLIP_INVALID", "start must be >= 0");
  const { track, clip } = findClip(comp, clipId);
  assertPlacement(track, { ...clip, start }, clip.id);
  clip.start = start;
  sortClips(track);
  return clip;
}

export interface TrimOptions {
  start?: number;
  duration?: number;
  offset?: number;
  end?: number;
}

export function trimClip(comp: Composition, clipId: string, options: TrimOptions): Clip {
  const { track, clip } = findClip(comp, clipId);
  const next = { ...clip } as Clip;
  if (options.offset !== undefined) {
    if (!Number.isFinite(options.offset) || options.offset < 0) throw new VigoError("E_CLIP_INVALID", "offset must be >= 0");
    next.offset = options.offset;
  }
  if (options.start !== undefined) {
    if (!Number.isFinite(options.start) || options.start < 0) throw new VigoError("E_CLIP_INVALID", "start must be >= 0");
    next.start = options.start;
  }
  if (options.end !== undefined) {
    const from = options.start ?? clip.start;
    if (!Number.isFinite(options.end) || options.end <= from) {
      throw new VigoError("E_CLIP_INVALID", `end must be greater than start (${from})`);
    }
    next.duration = options.end - from;
  } else if (options.duration !== undefined) {
    if (!Number.isFinite(options.duration) || options.duration <= 0) {
      throw new VigoError("E_CLIP_INVALID", "duration must be > 0");
    }
    next.duration = options.duration;
  }
  assertPlacement(track, next, clip.id);
  Object.assign(clip, next);
  sortClips(track);
  return clip;
}

export function splitClip(comp: Composition, clipId: string, at: number): { first: Clip; second: Clip } {
  const { track, clip } = findClip(comp, clipId);
  const relative = at - clip.start;
  if (!Number.isFinite(relative) || relative <= EPSILON || relative >= clip.duration - EPSILON) {
    throw new VigoError(
      "E_CLIP_INVALID",
      `split point ${at}s must be strictly inside clip "${clip.id}" (${clip.start}s .. ${clip.start + clip.duration}s)`,
    );
  }
  const secondId = uniqueId(
    `${clip.id}-b`,
    comp.tracks.flatMap((candidate) => candidate.clips.map((c) => c.id)),
  );
  const first = { ...clip, duration: relative } as Clip;
  const second = {
    ...clip,
    id: secondId,
    start: at,
    duration: clip.duration - relative,
    offset: (clip.offset ?? 0) + relative,
  } as Clip;
  Object.assign(clip, first);
  track.clips.push(second);
  sortClips(track);
  return { first: clip, second };
}

const PATCHABLE = new Set<keyof ClipPatch>([
  "start",
  "duration",
  "offset",
  "label",
  "src",
  "html",
  "background",
  "fit",
  "opacity",
  "volume",
  "fadeIn",
  "fadeOut",
]);

export function setClip(comp: Composition, clipId: string, patch: ClipPatch): Clip {
  const { track, clip } = findClip(comp, clipId);
  const next = { ...clip } as Clip;
  for (const [key, value] of Object.entries(patch)) {
    if (!PATCHABLE.has(key as keyof ClipPatch)) {
      throw new VigoError("E_CLIP_INVALID", `Cannot set "${key}" on a clip`);
    }
    if (value === undefined) continue;
    if (key === "start" || key === "duration" || key === "offset" || key === "opacity" || key === "volume" || key === "fadeIn" || key === "fadeOut") {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new VigoError("E_CLIP_INVALID", `${key} must be a number`);
      if (key === "duration" && n <= 0) throw new VigoError("E_CLIP_INVALID", "duration must be > 0");
      if ((key === "start" || key === "offset" || key === "fadeIn" || key === "fadeOut") && n < 0) {
        throw new VigoError("E_CLIP_INVALID", `${key} must be >= 0`);
      }
      (next as unknown as Record<string, unknown>)[key] = n;
    } else {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  if (next.kind === "html") {
    const html = next as HtmlClip;
    if (!html.src && !html.html) throw new VigoError("E_CLIP_INVALID", "html clip requires src or html");
    if (html.src && html.html) throw new VigoError("E_CLIP_INVALID", "use either src or html, not both");
  } else if (!next.src) {
    throw new VigoError("E_CLIP_INVALID", `${next.kind} clip requires src`);
  }
  assertPlacement(track, next, clip.id);
  Object.assign(clip, next);
  sortClips(track);
  return clip;
}

export function addTrack(comp: Composition, type: TrackType, id?: string): Track {
  if (!["html", "media", "audio"].includes(type)) {
    throw new VigoError("E_TRACK_INVALID", `Unknown track type "${type}"`);
  }
  const base = slugify(id ?? type, type);
  const finalId = uniqueId(id ?? base, comp.tracks.map((t) => t.id));
  if (!finalId) throw new VigoError("E_TRACK_INVALID", "Track id is required");
  const track: Track = { id: finalId, type, clips: [] };
  if (type === "audio") comp.tracks.push(track);
  else comp.tracks.splice(comp.tracks.filter((t) => t.type !== "audio").length, 0, track);
  return track;
}

export function removeTrack(comp: Composition, trackId: string): Track {
  const track = findTrack(comp, trackId);
  comp.tracks = comp.tracks.filter((t) => t.id !== trackId);
  return track;
}

export function summarizeComposition(comp: Composition, projectPath?: string): CompositionSummary {
  return {
    ...(projectPath ? { path: projectPath } : {}),
    ...(comp.name ? { name: comp.name } : {}),
    width: comp.width,
    height: comp.height,
    fps: comp.fps,
    duration: projectDuration(comp),
    ...(comp.background ? { background: comp.background } : {}),
    tracks: comp.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      clips: track.clips.map((clip) => ({
        id: clip.id,
        kind: clip.kind,
        start: clip.start,
        duration: clip.duration,
        end: clip.start + clip.duration,
        ...(clip.kind === "html" && (clip as HtmlClip).src ? { src: (clip as HtmlClip).src } : {}),
        ...(clip.kind !== "html" ? { src: (clip as AudioClip | MediaClip).src } : {}),
      })),
    })),
  };
}

/** Resolve a clip source relative to the project file. */
export function resolveProjectPath(projectFile: string, src: string): string {
  if (src.startsWith("file://")) return fileURLToPath(src);
  if (path.isAbsolute(src)) return src;
  return path.resolve(path.dirname(projectFile), src);
}

/** Store a path relative to the project, when possible, so projects are portable. */
export function toProjectRelativePath(projectFile: string, src: string): string {
  if (src.startsWith("file://")) return src;
  const absolute = path.resolve(src);
  const relative = path.relative(path.dirname(projectFile), absolute);
  if (relative.startsWith("..")) return absolute;
  return relative.split(path.sep).join("/");
}

/** Verify every source file referenced by a project exists. */
export async function verifyProjectFiles(comp: Composition, projectFile: string): Promise<string[]> {
  const problems: string[] = [];
  for (const track of comp.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === "html" && !(clip as HtmlClip).src) continue;
      const src = (clip as HtmlClip | MediaClip | AudioClip).src;
      if (!src) continue;
      if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("file://")) continue;
      const resolved = resolveProjectPath(projectFile, src);
      try {
        await readFile(resolved);
      } catch {
        problems.push(`${clip.id}: missing file ${resolved}`);
      }
    }
  }
  return problems;
}

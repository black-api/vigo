import path from "node:path";
import { existsSync } from "node:fs";
import { VigoError } from "../errors.ts";
import { probeMedia } from "../media/ffmpeg.ts";
import { writeJson } from "../util/fsx.ts";
import {
  addClip,
  addTrack,
  loadProject,
  projectDuration,
  toProjectRelativePath,
} from "./timeline.ts";
import type { AddClipInput, Clip, ClipKind, Composition, TrackType } from "./types.ts";

export interface AddClipRequest {
  track?: string;
  kind?: ClipKind;
  src?: string;
  html?: string;
  start?: number;
  duration?: number;
  offset?: number;
  label?: string;
  id?: string;
  fit?: "contain" | "cover" | "fill";
  opacity?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  background?: string;
}

export interface AddClipResult {
  clip: Clip;
  trackId: string;
  duration: number;
  composition: Composition;
}

export function inferKindFromPath(file: string): ClipKind {
  const ext = path.extname(file).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac"].includes(ext)) return "audio";
  if ([".html", ".htm"].includes(ext)) return "html";
  return "video";
}

/** Resolve sources, infer kind/duration, auto-create a matching track, and save. */
export async function addClipToProject(projectFile: string, request: AddClipRequest): Promise<AddClipResult> {
  const composition = await loadProject(projectFile);
  if (request.src && request.html) throw new VigoError("E_USAGE", "Use either src or html, not both");
  if (!request.src && !request.html) throw new VigoError("E_USAGE", "src or html is required");

  const absoluteSrc = request.src ? path.resolve(request.src) : undefined;
  if (absoluteSrc && !existsSync(absoluteSrc)) {
    throw new VigoError("E_FILE_NOT_FOUND", `Source not found: ${absoluteSrc}`);
  }
  const kind: ClipKind = request.html ? "html" : request.kind ?? inferKindFromPath(absoluteSrc as string);

  let trackId = request.track;
  if (!trackId) {
    const wantedType: TrackType = kind === "audio" ? "audio" : kind === "html" ? "html" : "media";
    const existing = composition.tracks.find((track) => track.type === wantedType);
    trackId = existing?.id ?? addTrack(composition, wantedType).id;
  }
  const track = composition.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    throw new VigoError(
      "E_TRACK_NOT_FOUND",
      `No track "${trackId}". Create one first: vigo track add ${projectFile} --type html`,
    );
  }

  let duration = request.duration;
  if (duration === undefined) {
    if (kind === "html" || kind === "image") duration = 5;
    else {
      const info = await probeMedia(absoluteSrc as string);
      duration = Math.max(0.05, info.duration - (request.offset ?? 0));
    }
  }

  const storedSrc = absoluteSrc ? toProjectRelativePath(projectFile, absoluteSrc) : undefined;
  const input: AddClipInput = {
    ...(request.id ? { id: request.id } : {}),
    kind,
    ...(storedSrc ? { src: storedSrc } : {}),
    ...(request.html ? { html: request.html } : {}),
    ...(request.start !== undefined ? { start: request.start } : {}),
    duration,
    ...(request.offset !== undefined ? { offset: request.offset } : {}),
    ...(request.label ? { label: request.label } : {}),
    ...(request.fit ? { fit: request.fit } : {}),
    ...(request.opacity !== undefined ? { opacity: request.opacity } : {}),
    ...(request.volume !== undefined ? { volume: request.volume } : {}),
    ...(request.fadeIn !== undefined ? { fadeIn: request.fadeIn } : {}),
    ...(request.fadeOut !== undefined ? { fadeOut: request.fadeOut } : {}),
    ...(request.background ? { background: request.background } : {}),
  };

  const clip = addClip(composition, trackId, input);
  await writeJson(projectFile, composition);
  return { clip, trackId, duration: projectDuration(composition), composition };
}

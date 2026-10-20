export type {
  AddClipInput,
  AudioClip,
  Clip,
  ClipKind,
  ClipPatch,
  Composition,
  CompositionSummary,
  Fit,
  HtmlClip,
  MediaClip,
  Track,
  TrackType,
} from "./core/types.ts";

export {
  addClip,
  addTrack,
  createComposition,
  findClip,
  findTrack,
  loadProject,
  moveClip,
  normalizeComposition,
  projectDuration,
  removeClip,
  removeTrack,
  resolveProjectPath,
  saveProject,
  setClip,
  splitClip,
  summarizeComposition,
  toProjectRelativePath,
  trimClip,
  validateComposition,
  verifyProjectFiles,
} from "./core/timeline.ts";

export { addClipToProject, inferKindFromPath } from "./core/project-ops.ts";
export type { AddClipRequest, AddClipResult } from "./core/project-ops.ts";

export { htmlToVideo, renderComposition, renderProject } from "./render/render.ts";
export type {
  HtmlToVideoOptions,
  HtmlToVideoResult,
  RenderOptions,
  RenderProgress,
  RenderResult,
} from "./render/render.ts";

export { diagnose } from "./system.ts";
export type { Diagnostics } from "./system.ts";

export { probeMedia } from "./media/ffmpeg.ts";
export type { MediaInfo } from "./media/ffmpeg.ts";

export {
  concatMedia,
  convertMedia,
  extractFrames,
  thumbnail,
} from "./media/ops.ts";
export type {
  ConcatOptions,
  ConvertOptions,
  ConvertResult,
  ExtractFramesOptions,
  ThumbnailOptions,
} from "./media/ops.ts";

export { createMcpServer, runMcpServer } from "./mcp/server.ts";
export { GUIDE_MARKDOWN } from "./guide.ts";
export { VigoError } from "./errors.ts";

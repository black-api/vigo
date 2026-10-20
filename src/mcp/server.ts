import path from "node:path";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GUIDE_MARKDOWN } from "../guide.ts";
import { VigoError } from "../errors.ts";
import { ensureDir, slugify, writeJson } from "../util/fsx.ts";
import { diagnose } from "../system.ts";
import { probeMedia } from "../media/ffmpeg.ts";
import { concatMedia, convertMedia, extractFrames, thumbnail } from "../media/ops.ts";
import {
  createComposition,
  loadProject,
  normalizeComposition,
  removeClip,
  setClip,
  splitClip,
  summarizeComposition,
  trimClip,
  moveClip,
  validateComposition,
  verifyProjectFiles,
} from "../core/timeline.ts";
import { addClipToProject, type AddClipRequest } from "../core/project-ops.ts";
import type { ClipPatch, ClipKind, Composition } from "../core/types.ts";
import { htmlToVideo, renderProject } from "../render/render.ts";

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(value: unknown): ToolResponse {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

async function guarded(work: () => Promise<unknown> | unknown): Promise<ToolResponse> {
  try {
    return ok(await work());
  } catch (error) {
    const message = error instanceof VigoError
      ? `${error.code}: ${error.message}${error.details ? `\n${JSON.stringify(error.details, null, 2)}` : ""}`
      : (error as Error).message;
    return { content: [{ type: "text", text: `error: ${message}` }], isError: true };
  }
}

function resolveProject(file: string): string {
  return path.resolve(file);
}

function projectOutput(projectFile: string, composition: Composition, output?: string): string {
  if (output) return path.resolve(output);
  return path.join(path.dirname(projectFile), "out", `${slugify(composition.name ?? "video")}.mp4`);
}

const projectPath = z.string().describe("Path to a vigo project JSON file (resolved from the server cwd)");
const optionalNumber = z.number().optional();
const optionalString = z.string().optional();

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "vigo", version: "0.1.0" },
    {
      instructions:
        "vigo is an agent-first video engine. Build videos from HTML scenes and JSON timelines, " +
        "then render with headless Chromium + ffmpeg. Read the vigo://guide resource for the " +
        "timeline schema and the deterministic HTML seek contract. All paths are local; remote " +
        "assets must be downloaded first.",
    },
  );

  server.registerResource(
    "guide",
    "vigo://guide",
    {
      title: "vigo agent guide",
      description: "Timeline schema, deterministic HTML motion contract, CLI, and MCP usage.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDE_MARKDOWN }],
    }),
  );

  server.registerTool(
    "vigo_guide",
    { title: "vigo guide", description: "Return the full vigo agent guide as markdown." },
    async () => ok(GUIDE_MARKDOWN),
  );

  server.registerTool(
    "vigo_doctor",
    {
      title: "Check vigo environment",
      description: "Check Node, ffmpeg, ffprobe, and Chromium availability before rendering.",
    },
    async () => guarded(async () => diagnose()),
  );

  server.registerTool(
    "vigo_create_project",
    {
      title: "Create video project",
      description:
        "Create a vigo timeline JSON project. Optionally pass full tracks and write HTML scene files in one call. " +
        "Visual tracks composite in array order; clips in one track cannot overlap.",
      inputSchema: {
        path: z.string().describe("Project JSON path, for example videos/demo/vigo.json"),
        name: optionalString,
        width: optionalNumber,
        height: optionalNumber,
        fps: optionalNumber,
        duration: z.number().optional().describe("Explicit composition length in seconds"),
        background: optionalString.describe("CSS color, for example #0b0d12"),
        tracks: z.array(z.any()).optional().describe("Full track array; omit to start with main + audio tracks"),
        scenes: z
          .array(z.object({ path: z.string(), html: z.string() }))
          .optional()
          .describe("HTML files to write, resolved relative to the project directory"),
        force: z.boolean().optional().describe("Overwrite an existing project file"),
      },
    },
    async (args) =>
      guarded(async () => {
        const projectFile = resolveProject(args.path);
        if (existsSync(projectFile) && !args.force) {
          throw new VigoError("E_EXISTS", `${projectFile} already exists (pass force: true to overwrite)`);
        }
        const base = createComposition({
          name: args.name ?? path.basename(path.dirname(projectFile)),
          ...(args.width !== undefined ? { width: args.width } : {}),
          ...(args.height !== undefined ? { height: args.height } : {}),
          ...(args.fps !== undefined ? { fps: args.fps } : {}),
          ...(args.duration !== undefined ? { duration: args.duration } : {}),
          ...(args.background !== undefined ? { background: args.background } : {}),
        });
        const composition = args.tracks
          ? normalizeComposition({
              ...base,
              tracks: args.tracks,
            })
          : base;
        const errors = validateComposition(composition);
        if (errors.length > 0) throw new VigoError("E_PROJECT_INVALID", "Invalid project", errors);

        const writtenScenes: string[] = [];
        for (const scene of args.scenes ?? []) {
          const scenePath = path.isAbsolute(scene.path) ? scene.path : path.resolve(path.dirname(projectFile), scene.path);
          await ensureDir(path.dirname(scenePath));
          await writeFile(scenePath, scene.html, "utf8");
          writtenScenes.push(scenePath);
        }
        await writeJson(projectFile, composition);
        return {
          ok: true,
          project: projectFile,
          scenes: writtenScenes,
          summary: summarizeComposition(composition, projectFile),
        };
      }),
  );

  server.registerTool(
    "vigo_get_project",
    {
      title: "Read video project",
      description: "Return the full timeline JSON and a compact summary for a vigo project.",
      inputSchema: { path: projectPath },
    },
    async (args) =>
      guarded(async () => {
        const projectFile = resolveProject(args.path);
        const composition = await loadProject(projectFile);
        return {
          ok: true,
          project: projectFile,
          summary: summarizeComposition(composition, projectFile),
          composition,
        };
      }),
  );

  server.registerTool(
    "vigo_write_scene",
    {
      title: "Write HTML scene",
      description: "Write an HTML scene file used by an html clip. CSS animations are seeked deterministically.",
      inputSchema: {
        path: z.string().describe("HTML file path"),
        html: z.string().describe("Full HTML document"),
      },
    },
    async (args) =>
      guarded(async () => {
        const file = path.resolve(args.path);
        await ensureDir(path.dirname(file));
        await writeFile(file, args.html, "utf8");
        return { ok: true, path: file, bytes: Buffer.byteLength(args.html) };
      }),
  );

  server.registerTool(
    "vigo_add_clip",
    {
      title: "Add clip",
      description:
        "Add an HTML, video, image, or audio clip to a project. Duration defaults to 5s for HTML/images and the " +
        "media duration for video/audio. Missing tracks are created automatically when track is omitted.",
      inputSchema: {
        path: projectPath,
        track: optionalString.describe("Existing track id; defaults to a matching track"),
        kind: z.enum(["html", "video", "image", "audio"]).optional(),
        src: optionalString.describe("Source file path, resolved from the server cwd"),
        html: optionalString.describe("Inline HTML instead of src"),
        start: optionalNumber.describe("Timeline start in seconds; defaults to the end of the track"),
        duration: optionalNumber,
        offset: optionalNumber.describe("Seconds trimmed from the source start"),
        label: optionalString,
        id: optionalString,
        fit: z.enum(["contain", "cover", "fill"]).optional(),
        opacity: z.number().min(0).max(1).optional(),
        volume: optionalNumber,
        fadeIn: optionalNumber,
        fadeOut: optionalNumber,
        background: optionalString.describe("CSS background for an HTML scene"),
      },
    },
    async (args) =>
      guarded(async () => {
        const request: AddClipRequest = {
          ...(args.track !== undefined ? { track: args.track } : {}),
          ...(args.kind !== undefined ? { kind: args.kind as ClipKind } : {}),
          ...(args.src !== undefined ? { src: args.src } : {}),
          ...(args.html !== undefined ? { html: args.html } : {}),
          ...(args.start !== undefined ? { start: args.start } : {}),
          ...(args.duration !== undefined ? { duration: args.duration } : {}),
          ...(args.offset !== undefined ? { offset: args.offset } : {}),
          ...(args.label !== undefined ? { label: args.label } : {}),
          ...(args.id !== undefined ? { id: args.id } : {}),
          ...(args.fit !== undefined ? { fit: args.fit } : {}),
          ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
          ...(args.volume !== undefined ? { volume: args.volume } : {}),
          ...(args.fadeIn !== undefined ? { fadeIn: args.fadeIn } : {}),
          ...(args.fadeOut !== undefined ? { fadeOut: args.fadeOut } : {}),
          ...(args.background !== undefined ? { background: args.background } : {}),
        };
        const projectFile = resolveProject(args.path);
        const result = await addClipToProject(projectFile, request);
        return {
          ok: true,
          clip: result.clip,
          track: result.trackId,
          summary: summarizeComposition(result.composition, projectFile),
        };
      }),
  );

  server.registerTool(
    "vigo_edit",
    {
      title: "Edit clip",
      description:
        "Edit a clip in the JSON timeline: trim (start/duration/end/offset), move (to), split (at), remove, or set properties.",
      inputSchema: {
        path: projectPath,
        clip: z.string().describe("Clip id"),
        action: z.enum(["trim", "move", "split", "remove", "set"]),
        start: optionalNumber,
        duration: optionalNumber,
        offset: optionalNumber,
        end: optionalNumber,
        at: optionalNumber.describe("Split point in timeline seconds"),
        to: optionalNumber.describe("New start in timeline seconds for move"),
        props: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Properties for set: duration, offset, volume, fadeIn, fadeOut, fit, opacity, label, src, html, background"),
      },
    },
    async (args) =>
      guarded(async () => {
        const projectFile = resolveProject(args.path);
        const composition = await loadProject(projectFile);
        let result: unknown;
        if (args.action === "trim") {
          result = trimClip(composition, args.clip, {
            start: args.start,
            duration: args.duration,
            offset: args.offset,
            end: args.end,
          });
        } else if (args.action === "move") {
          if (args.to === undefined) throw new VigoError("E_USAGE", "move needs to");
          result = moveClip(composition, args.clip, args.to);
        } else if (args.action === "split") {
          if (args.at === undefined) throw new VigoError("E_USAGE", "split needs at");
          result = splitClip(composition, args.clip, args.at);
        } else if (args.action === "remove") {
          result = removeClip(composition, args.clip);
        } else {
          const numericKeys = new Set(["start", "duration", "offset", "volume", "fadeIn", "fadeOut", "opacity"]);
          const patch: Record<string, string | number> = {};
          for (const [key, value] of Object.entries(args.props ?? {})) {
            patch[key] = numericKeys.has(key) ? Number(value) : String(value);
          }
          if (Object.keys(patch).length === 0) throw new VigoError("E_USAGE", "set needs props");
          result = setClip(composition, args.clip, patch as ClipPatch);
        }
        await writeJson(projectFile, composition);
        return {
          ok: true,
          result,
          summary: summarizeComposition(composition, projectFile),
        };
      }),
  );

  server.registerTool(
    "vigo_render",
    {
      title: "Render project",
      description:
        "Render a vigo project to MP4/WebM/MOV/MKV. Captures each HTML layer frame by frame with deterministic seeking, " +
        "composites media and audio with ffmpeg, then returns the output path.",
      inputSchema: {
        path: projectPath,
        output: optionalString.describe("Output path; defaults to <project dir>/out/<name>.mp4"),
        width: optionalNumber,
        height: optionalNumber,
        fps: optionalNumber,
        duration: optionalNumber,
        crf: z.number().min(0).max(63).optional(),
        preset: optionalString.describe("x264 preset, for example veryfast, medium, slow"),
        frames_dir: optionalString.describe("Keep rendered frames in this directory"),
        frame_format: z.enum(["png", "jpeg"]).optional().describe("jpeg is faster for one opaque HTML layer"),
        jpeg_quality: z.number().min(1).max(100).optional(),
      },
    },
    async (args) =>
      guarded(async () => {
        const projectFile = resolveProject(args.path);
        const composition = await loadProject(projectFile);
        const files = await verifyProjectFiles(composition, projectFile);
        if (files.length > 0) throw new VigoError("E_SOURCE_MISSING", "Missing project files", files);
        const output = projectOutput(projectFile, composition, args.output);
        const result = await renderProject(projectFile, {
          output,
          width: args.width,
          height: args.height,
          fps: args.fps,
          duration: args.duration,
          crf: args.crf,
          preset: args.preset,
          framesDir: args.frames_dir,
          frameFormat: args.frame_format,
          jpegQuality: args.jpeg_quality,
        });
        return { ok: true, project: projectFile, ...result };
      }),
  );

  server.registerTool(
    "vigo_html_to_video",
    {
      title: "HTML to video",
      description:
        "Render inline HTML or an HTML file directly to video. CSS animations are seeked frame by frame; " +
        "use window.vigo.seek(t) for JS-driven animation. Optional audio bed with fades.",
      inputSchema: {
        output: z.string().describe("Output video path"),
        html: optionalString.describe("Inline full HTML document"),
        html_path: optionalString.describe("Path to an HTML file"),
        duration: optionalNumber.describe("Seconds; defaults to audio length, or 5"),
        width: optionalNumber,
        height: optionalNumber,
        fps: optionalNumber,
        background: optionalString,
        audio: optionalString.describe("Optional audio file path"),
        audio_volume: optionalNumber,
        audio_start: optionalNumber,
        fade_in: optionalNumber,
        fade_out: optionalNumber,
        crf: z.number().min(0).max(63).optional(),
        preset: optionalString,
        frame_format: z.enum(["png", "jpeg"]).optional(),
        jpeg_quality: z.number().min(1).max(100).optional(),
      },
    },
    async (args) =>
      guarded(async () => {
        if (args.html && args.html_path) {
          throw new VigoError("E_USAGE", "Provide html or html_path, not both");
        }
        const result = await htmlToVideo({
          output: path.resolve(args.output),
          ...(args.html !== undefined ? { html: args.html } : {}),
          ...(args.html_path !== undefined ? { htmlPath: path.resolve(args.html_path) } : {}),
          ...(args.duration !== undefined ? { duration: args.duration } : {}),
          ...(args.width !== undefined ? { width: args.width } : {}),
          ...(args.height !== undefined ? { height: args.height } : {}),
          ...(args.fps !== undefined ? { fps: args.fps } : {}),
          ...(args.background !== undefined ? { background: args.background } : {}),
          ...(args.audio !== undefined ? { audio: path.resolve(args.audio) } : {}),
          ...(args.audio_volume !== undefined ? { audioVolume: args.audio_volume } : {}),
          ...(args.audio_start !== undefined ? { audioStart: args.audio_start } : {}),
          ...(args.fade_in !== undefined ? { fadeIn: args.fade_in } : {}),
          ...(args.fade_out !== undefined ? { fadeOut: args.fade_out } : {}),
          ...(args.crf !== undefined ? { crf: args.crf } : {}),
          ...(args.preset !== undefined ? { preset: args.preset } : {}),
          ...(args.frame_format !== undefined ? { frameFormat: args.frame_format } : {}),
          ...(args.jpeg_quality !== undefined ? { jpegQuality: args.jpeg_quality } : {}),
        });
        return { ok: true, ...result };
      }),
  );

  server.registerTool(
    "vigo_convert",
    {
      title: "Convert media",
      description: "Convert video, audio, or image input to mp4/webm/gif/mp3/wav/m4a/flac with optional trim and scale.",
      inputSchema: {
        input: z.string(),
        output: z.string(),
        start: optionalNumber,
        duration: optionalNumber,
        width: optionalNumber,
        height: optionalNumber,
        fps: optionalNumber,
        crf: z.number().min(0).max(63).optional(),
        keep_audio: z.boolean().optional(),
      },
    },
    async (args) =>
      guarded(async () =>
        convertMedia(path.resolve(args.input), {
          output: path.resolve(args.output),
          ...(args.start !== undefined ? { start: args.start } : {}),
          ...(args.duration !== undefined ? { duration: args.duration } : {}),
          ...(args.width !== undefined ? { width: args.width } : {}),
          ...(args.height !== undefined ? { height: args.height } : {}),
          ...(args.fps !== undefined ? { fps: args.fps } : {}),
          ...(args.crf !== undefined ? { crf: args.crf } : {}),
          ...(args.keep_audio !== undefined ? { keepAudio: args.keep_audio } : {}),
        }),
      ),
  );

  server.registerTool(
    "vigo_probe",
    {
      title: "Probe media",
      description: "Return duration, dimensions, fps, codecs, and size for a media file.",
      inputSchema: { input: z.string() },
    },
    async (args) => guarded(async () => ({ ok: true, ...(await probeMedia(path.resolve(args.input))) })),
  );

  server.registerTool(
    "vigo_thumbnail",
    {
      title: "Extract thumbnail",
      description: "Write one poster frame from a video at a given time.",
      inputSchema: {
        input: z.string(),
        output: z.string().describe("PNG/JPG output path"),
        at: optionalNumber.describe("Seconds; defaults to 0"),
        width: optionalNumber,
      },
    },
    async (args) =>
      guarded(async () => ({
        ok: true,
        ...(await thumbnail(path.resolve(args.input), {
          output: path.resolve(args.output),
          ...(args.at !== undefined ? { at: args.at } : {}),
          ...(args.width !== undefined ? { width: args.width } : {}),
        })),
      })),
  );

  server.registerTool(
    "vigo_extract_frames",
    {
      title: "Extract frames",
      description: "Write video frames as png/jpg files at a fixed fps.",
      inputSchema: {
        input: z.string(),
        output_dir: z.string(),
        fps: optionalNumber,
        start: optionalNumber,
        duration: optionalNumber,
        width: optionalNumber,
        format: z.enum(["png", "jpg"]).optional(),
      },
    },
    async (args) =>
      guarded(async () => ({
        ok: true,
        ...(await extractFrames(path.resolve(args.input), {
          outputDir: path.resolve(args.output_dir),
          ...(args.fps !== undefined ? { fps: args.fps } : {}),
          ...(args.start !== undefined ? { start: args.start } : {}),
          ...(args.duration !== undefined ? { duration: args.duration } : {}),
          ...(args.width !== undefined ? { width: args.width } : {}),
          ...(args.format !== undefined ? { format: args.format } : {}),
        })),
      })),
  );

  server.registerTool(
    "vigo_concat",
    {
      title: "Concatenate media",
      description: "Join clips in order, normalizing resolution, fps, and audio (silence is added when a clip has none).",
      inputSchema: {
        inputs: z.array(z.string()).min(1),
        output: z.string(),
        width: optionalNumber,
        height: optionalNumber,
        fps: optionalNumber,
        crf: z.number().min(0).max(63).optional(),
      },
    },
    async (args) =>
      guarded(async () => ({
        ok: true,
        ...(await concatMedia({
          inputs: args.inputs.map((file) => path.resolve(file)),
          output: path.resolve(args.output),
          ...(args.width !== undefined ? { width: args.width } : {}),
          ...(args.height !== undefined ? { height: args.height } : {}),
          ...(args.fps !== undefined ? { fps: args.fps } : {}),
          ...(args.crf !== undefined ? { crf: args.crf } : {}),
        })),
      })),
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive until the client closes stdio.
  process.stdin.on("end", () => {
    void server.close();
  });
}


import { spawn } from "node:child_process";
import { VigoError } from "../errors.ts";
import { tail } from "../util/fsx.ts";

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; maxStderr?: number } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const maxStderr = options.maxStderr ?? 200_000;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > maxStderr) stderr = stderr.slice(-maxStderr);
    });
    child.on("error", (error) => {
      reject(
        new VigoError(
          "E_PROCESS",
          `Cannot run ${command}: ${error.message}. Is ${command} installed?`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new VigoError(
            "E_PROCESS",
            `${command} exited with code ${code}: ${tail(stderr, 12) || "no output"}`,
            { command, args },
          ),
        );
      }
    });
  });
}

export async function ffmpeg(args: string[], cwd?: string): Promise<void> {
  try {
    await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd });
  } catch (error) {
    if (error instanceof VigoError) {
      throw new VigoError("E_FFMPEG", `ffmpeg failed: ${error.message}`, error.details);
    }
    throw error;
  }
}

export interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  tags?: Record<string, string>;
}

export interface ProbeResult {
  streams?: ProbeStream[];
  format?: {
    filename?: string;
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
}

export interface MediaInfo {
  path: string;
  duration: number;
  size: number;
  format: string;
  bitrate: number;
  video?: {
    codec: string;
    width: number;
    height: number;
    fps: number;
  };
  audio?: {
    codec: string;
    sampleRate: number;
    channels: number;
  };
}

export async function probeMedia(file: string): Promise<MediaInfo> {
  let parsed: ProbeResult;
  try {
    const { stdout } = await runProcess("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ]);
    parsed = JSON.parse(stdout) as ProbeResult;
  } catch (error) {
    throw new VigoError("E_PROBE", `Cannot probe ${file}: ${(error as Error).message}`);
  }

  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");
  if (!videoStream && !audioStream) {
    throw new VigoError("E_PROBE", `${file} has no audio or video streams`);
  }

  return {
    path: file,
    duration: Number(parsed.format?.duration ?? videoStream?.duration ?? 0) || 0,
    size: Number(parsed.format?.size ?? 0) || 0,
    format: parsed.format?.format_name ?? "unknown",
    bitrate: Number(parsed.format?.bit_rate ?? 0) || 0,
    ...(videoStream
      ? {
          video: {
            codec: videoStream.codec_name ?? "unknown",
            width: videoStream.width ?? 0,
            height: videoStream.height ?? 0,
            fps: parseRate(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
          },
        }
      : {}),
    ...(audioStream
      ? {
          audio: {
            codec: audioStream.codec_name ?? "unknown",
            sampleRate: Number(audioStream.sample_rate ?? 0) || 0,
            channels: audioStream.channels ?? 0,
          },
        }
      : {}),
  };
}

export function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const parts = rate.split("/").map(Number);
  const num = parts[0];
  const den = parts[1];
  if (num !== undefined && den !== undefined && den !== 0 && Number.isFinite(num) && Number.isFinite(den)) {
    return num / den;
  }
  return Number(rate) || 0;
}

/** Read tool versions for `vigo doctor` without throwing. */
export async function toolVersion(command: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await runProcess(command, ["-version"]);
    return (stdout || stderr).split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

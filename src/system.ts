import { findChromium } from "./render/browser.ts";
import { toolVersion } from "./media/ffmpeg.ts";

export interface Diagnostics {
  ok: boolean;
  tools: {
    node: string;
    ffmpeg: string | null;
    ffprobe: string | null;
    chromium: string | null;
    chromiumPath: string | null;
    error?: string;
  };
}

export async function diagnose(): Promise<Diagnostics> {
  const ffmpeg = await toolVersion("ffmpeg");
  const ffprobe = await toolVersion("ffprobe");
  let chromiumPath: string | null = null;
  let chromium: string | null = null;
  let error: string | undefined;
  try {
    chromiumPath = findChromium();
    chromium = await toolVersion(chromiumPath);
  } catch (caught) {
    error = (caught as Error).message;
  }
  return {
    ok: Boolean(ffmpeg && ffprobe && chromium),
    tools: {
      node: process.version,
      ffmpeg,
      ffprobe,
      chromium,
      chromiumPath,
      ...(error ? { error } : {}),
    },
  };
}

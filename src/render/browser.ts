import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { VigoError } from "../errors.ts";

const CHROMIUM_CANDIDATES: Partial<Record<NodeJS.Platform, string[]>> = {
  linux: [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "/usr/bin/brave-browser",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
  ],
};

export function findChromium(): string {
  const configured = process.env.VIGO_CHROME ?? process.env.CHROME_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured) {
    if (existsSync(configured)) return configured;
    throw new VigoError(
      "E_BROWSER_NOT_FOUND",
      `Configured Chromium does not exist: ${configured} (set VIGO_CHROME to a valid path)`,
    );
  }
  const candidates = CHROMIUM_CANDIDATES[process.platform] ?? [];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Last resort: rely on PATH lookup.
  for (const name of ["chromium", "google-chrome", "chrome"]) {
    if (process.env.PATH?.split(path.delimiter).some((dir) => existsSync(path.join(dir, name)))) {
      return name;
    }
  }
  throw new VigoError(
    "E_BROWSER_NOT_FOUND",
    "No Chromium/Chrome found. Install Chromium or set VIGO_CHROME=/path/to/chrome",
  );
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = findChromium();
  try {
    return await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--mute-audio",
        "--force-color-profile=srgb",
        "--disable-lcd-text",
        "--font-render-hinting=none",
        "--allow-file-access-from-files",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
  } catch (error) {
    throw new VigoError(
      "E_BROWSER_LAUNCH",
      `Could not launch Chromium (${executablePath}): ${(error as Error).message}`,
      { executablePath },
    );
  }
}

export async function openScene(browser: Browser, width: number, height: number): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(installVigoRuntime);
  page.setDefaultTimeout(30_000);
  return page;
}

/**
 * Load an HTML scene. Either a local file or inline HTML.
 * Waits for fonts, images, and an optional `window.vigo.ready` promise.
 */
export async function loadScene(
  page: Page,
  clip: { src?: string; html?: string; background?: string },
  projectDir: string,
): Promise<void> {
  if (clip.src) {
    const file = clip.src.startsWith("file://")
      ? clip.src
      : pathToFileURL(path.resolve(projectDir, clip.src)).href;
    try {
      await page.goto(file, { waitUntil: "load", timeout: 30_000 });
    } catch (error) {
      throw new VigoError("E_SCENE_LOAD", `Could not load scene ${file}: ${(error as Error).message}`);
    }
  } else if (clip.html) {
    try {
      await page.setContent(clip.html, { waitUntil: "load", timeout: 30_000 });
    } catch (error) {
      throw new VigoError("E_SCENE_LOAD", `Could not load inline HTML: ${(error as Error).message}`);
    }
  } else {
    throw new VigoError("E_SCENE_LOAD", "HTML clip needs src or html");
  }

  // setContent does not create a fresh document, so re-install explicitly.
  // (goto also installs it earlier through evaluateOnNewDocument.)
  await page.evaluate(installVigoRuntime);

  await page.evaluate(async () => {
    const root = document.documentElement;
    const style = document.createElement("style");
    style.textContent = `
      ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      html { scrollbar-width: none !important; caret-color: transparent !important; }
    `;
    root.appendChild(style);
    await (document.fonts?.ready ?? Promise.resolve());
    await Promise.all(
      Array.from(document.images).map(
        (image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                image.addEventListener("load", () => resolve(), { once: true });
                image.addEventListener("error", () => resolve(), { once: true });
                setTimeout(resolve, 3000);
              }),
      ),
    );
    const vigo = (window as unknown as { vigo?: { ready?: Promise<unknown> } }).vigo;
    if (vigo?.ready && typeof vigo.ready.then === "function") {
      await Promise.race([vigo.ready, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    }
  });

  if (clip.background) {
    await page.evaluate((background) => {
      document.documentElement.style.background = background;
      if (document.body) document.body.style.background = background;
    }, clip.background);
  }
}

/** Seek CSS/WAAPI animations, media elements, and an optional JS hook. */
export async function seekScene(page: Page, time: number): Promise<void> {
  await page.evaluate(async (t) => {
    const runtime = (window as unknown as { __vigo?: { seek?: (time: number) => Promise<void> } }).__vigo;
    if (!runtime?.seek) throw new Error("vigo runtime was not installed");
    await runtime.seek(t);
  }, time);
}

export interface ScreenshotOptions {
  width: number;
  height: number;
  transparent?: boolean;
  format?: "png" | "jpeg";
  quality?: number;
}

export async function captureFrame(page: Page, options: ScreenshotOptions): Promise<Buffer> {
  const format = options.format ?? "png";
  return (await page.screenshot({
    type: format,
    ...(format === "jpeg"
      ? { quality: options.quality ?? 92, omitBackground: false }
      : { omitBackground: options.transparent ?? true }),
    // Screenshot encoding is the capture bottleneck; this keeps alpha for PNG
    // and is roughly three times faster than the default PNG path.
    optimizeForSpeed: true,
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: options.width, height: options.height },
  })) as Buffer;
}

/**
 * Runs in every page before the scene's own scripts.
 *
 * Deterministic contract:
 * - pause every CSS animation / Web Animation and set it to time t
 * - pause media and seek it to t
 * - call the scene's optional hook: window.vigo.seek(t), window.vigoSeek(t),
 *   or window.seek(t)
 */
function installVigoRuntime(): void {
  type VigoWindow = Window & {
    __vigo?: { seek: (time: number) => Promise<void> };
    vigo?: { seek?: (time: number) => unknown; ready?: Promise<unknown> };
    vigoSeek?: (time: number) => unknown;
    seek?: (time: number) => unknown;
  };
  const w = window as VigoWindow;

  const setAnimations = (seconds: number) => {
    const animations = typeof document.getAnimations === "function" ? document.getAnimations() : [];
    for (const animation of animations) {
      try {
        animation.pause();
        animation.currentTime = seconds * 1000;
      } catch {
        // Ignore animations that cannot be seeked (for example, detached ones).
      }
    }
  };

  const seek = async (time: number) => {
    const seconds = Math.max(0, Number(time) || 0);
    setAnimations(seconds);

    const media = Array.from(document.querySelectorAll<HTMLMediaElement>("video, audio"));
    await Promise.all(
      media.map(
        (element) =>
          new Promise<void>((resolve) => {
            try {
              element.pause();
              const duration = Number.isFinite(element.duration) ? element.duration : seconds;
              const target = Math.max(0, Math.min(seconds, Math.max(0, duration - 0.001)));
              if (Math.abs(element.currentTime - target) < 0.0005) return resolve();
              let settled = false;
              const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
              };
              element.addEventListener("seeked", finish, { once: true });
              element.addEventListener("error", finish, { once: true });
              element.currentTime = target;
              setTimeout(finish, 750);
            } catch {
              resolve();
            }
          }),
      ),
    );

    const hook = w.vigo?.seek ?? w.vigoSeek ?? w.seek;
    if (typeof hook === "function") {
      await hook.call(w.vigo ?? w, seconds);
    }
    // If the hook created new animations, align those too.
    setAnimations(seconds);
  };

  w.__vigo = { seek };
}

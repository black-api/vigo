import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function cli(args, options = {}) {
  const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], {
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return { stdout, stderr };
}

test("CLI init -> inspect -> render keeps stdout machine-readable", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vigo-cli-"));
  try {
    await cli([
      "init", dir,
      "--name", "cli-demo",
      "--width", "160", "--height", "90", "--fps", "5", "--duration", "0.5",
      "--json",
    ]);
    const project = path.join(dir, "vigo.json");

    const inspected = JSON.parse((await cli(["inspect", project, "--json"])).stdout);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.name, "cli-demo");
    assert.equal(inspected.duration, 0.5);
    assert.equal(inspected.tracks[0].clips[0].id, "intro");

    const output = path.join(dir, "out.mp4");
    const rendered = JSON.parse((await cli(["render", project, "-o", output, "--json", "--quiet"])).stdout);
    assert.equal(rendered.ok, true);
    assert.equal(rendered.width, 160);
    assert.equal(rendered.fps, 5);
    assert.ok((await stat(output)).size > 500);

    const probed = JSON.parse((await cli(["probe", output, "--json"])).stdout);
    assert.equal(probed.ok, true);
    assert.equal(probed.video.width, 160);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI reports JSON errors with a non-zero exit", { timeout: 30_000 }, async () => {
  await assert.rejects(
    () => cli(["render", "/definitely/missing/vigo.json", "--json"]),
    (error) => {
      assert.equal(error.code, 1);
      const payload = JSON.parse(error.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.error.code, "E_PROJECT_READ");
      return true;
    },
  );
});

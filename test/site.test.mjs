import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");

function pngSize(relative) {
  const buffer = readFileSync(path.join(ROOT, relative));
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${relative} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("landing page references the brand assets", () => {
  const html = read("index.html");
  for (const asset of [
    "assets/site.css",
    "assets/site.js",
    "assets/icon-192.png",
    "assets/favicon.svg",
    "assets/apple-touch-icon.png",
    "assets/og-image.png",
    "favicon.ico",
    "renders/vigo-ad.mp4",
    "renders/vigo-explainer.mp4",
    "renders/vigo-ad-poster.jpg",
    "renders/vigo-explainer-poster.jpg",
  ]) {
    assert.ok(html.includes(asset), `index.html should reference ${asset}`);
  }
});

test("every local asset referenced by the landing page exists", () => {
  const html = read("index.html");
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  const local = references.filter((value) => !/^(https?:|#|mailto:)/.test(value));
  assert.ok(local.length > 6, "expected the page to link local assets");
  for (const value of local) {
    assert.ok(existsSync(path.join(ROOT, value)), `missing local asset: ${value}`);
  }
});

test("icon assets have the expected format and size", () => {
  assert.deepEqual(pngSize("assets/icon-512.png"), { width: 512, height: 512 });
  assert.deepEqual(pngSize("assets/icon-192.png"), { width: 192, height: 192 });
  assert.deepEqual(pngSize("assets/apple-touch-icon.png"), { width: 180, height: 180 });

  const og = pngSize("assets/og-image.png");
  assert.deepEqual(og, { width: 1200, height: 630 });

  const ico = readFileSync(path.join(ROOT, "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0, "favicon.ico must start with the ICO magic");
  assert.equal(ico.readUInt16LE(2), 1, "favicon.ico must be an icon file");
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 2, "favicon.ico should hold several sizes");
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    sizes.push(ico.readUInt8(entry) === 0 ? 256 : ico.readUInt8(entry));
  }
  assert.ok(sizes.includes(16), "favicon.ico should include a 16px frame");
  assert.ok(sizes.includes(32), "favicon.ico should include a 32px frame");
});

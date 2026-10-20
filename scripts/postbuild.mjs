import { chmod } from "node:fs/promises";

await chmod(new URL("../dist/cli.js", import.meta.url), 0o755);
console.log("vigo: build ok (dist/cli.js)");

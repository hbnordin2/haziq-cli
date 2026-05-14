#!/usr/bin/env bun
/**
 * Bundle src/cli.ts → dist/cli.js as a single ESM file with a Node shebang.
 * The shebang lets npm wire up the `haziq` bin without an extra shim file.
 */
import { chmod, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const ROOT = new URL("./", import.meta.url).pathname;
const OUT = `${ROOT}dist`;

if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });

const result = await Bun.build({
  entrypoints: [`${ROOT}src/cli.ts`],
  outdir: OUT,
  target: "node",
  format: "esm",
  minify: false,
  splitting: false,
  banner: "#!/usr/bin/env node",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await chmod(`${OUT}/cli.js`, 0o755);
console.log(`✓ built ${OUT}/cli.js`);

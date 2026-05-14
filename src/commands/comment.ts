/**
 * `haziq comment <slug>` — post a comment on an essay.
 *
 * Body sources, in priority order:
 *   1. --body "..."           inline string
 *   2. --from-file <path>     read the file
 *   3. stdin                  if piped
 *
 * The comment goes in as 'pending' and the owner gets an email with
 * approve/reject buttons. The reply doesn't appear until that's done.
 */
import { readFile } from "node:fs/promises";
import { apiJson, AuthRequired } from "../api.js";

interface PostBody {
  slug: string;
  body: string;
  parent_id?: string | null;
}

interface PostResponse {
  ok?: boolean;
  message?: string;
}

function parseArgs(args: string[]): {
  slug: string | null;
  body: string | null;
  fromFile: string | null;
  parent: string | null;
} {
  let slug: string | null = null;
  let body: string | null = null;
  let fromFile: string | null = null;
  let parent: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--body") body = args[++i] ?? null;
    else if (a === "--from-file") fromFile = args[++i] ?? null;
    else if (a === "--parent") parent = args[++i] ?? null;
    else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else if (!slug) {
      slug = a;
    }
  }
  return { slug, body, fromFile, parent };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf-8");
}

export async function comment(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed.slug) {
    console.error("Usage: haziq comment <slug> [--body \"...\"] [--from-file PATH] [--parent COMMENT_ID]");
    process.exitCode = 2;
    return;
  }
  let body = parsed.body;
  if (!body && parsed.fromFile) {
    body = (await readFile(parsed.fromFile, "utf-8")).trim();
  }
  if (!body) {
    body = (await readStdin()).trim();
  }
  if (!body) {
    console.error("No comment body. Pass --body, --from-file, or pipe via stdin.");
    process.exitCode = 2;
    return;
  }

  const payload: PostBody = { slug: parsed.slug, body, parent_id: parsed.parent };

  try {
    const res = await apiJson<PostResponse>("/v1/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log(res.message ?? "Submitted.");
  } catch (err) {
    if (err instanceof AuthRequired) {
      console.error("Sign in first: haziq login");
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

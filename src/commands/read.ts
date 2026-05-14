/**
 * `haziq read <slug-or-url>` — fetches the essay JSON, converts the body
 * HTML to markdown, prints frontmatter + body to stdout. Designed to be
 * piped into Claude Code or Codex; raw HTML eats tokens for no benefit.
 *
 * Public endpoint — no auth required. Slug is normalized: a full URL or
 * /essays/<slug> path also works.
 *
 * Use --html to get the raw body_html instead (useful for debugging or for
 * tools that prefer HTML).
 */
import { apiJson } from "../api.js";
import { htmlToMarkdown } from "../html-to-md.js";

interface EssayDetail {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  url: string;
  body_html: string;
  tier?: string;
}

function normalizeSlug(input: string): string {
  let s = input.trim();
  try {
    if (s.startsWith("http")) {
      s = new URL(s).pathname;
    }
  } catch {
    // not a URL, keep as-is
  }
  s = s.replace(/^\/+/, "").replace(/\/+$/, "");
  s = s.replace(/^essays\//, "");
  s = s.replace(/\.(html|json)$/i, "");
  return s;
}

export async function read(args: string[]): Promise<void> {
  let slugArg: string | null = null;
  let raw = false;
  for (const a of args) {
    if (a === "--html" || a === "--raw") raw = true;
    else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exitCode = 2;
      return;
    } else if (!slugArg) {
      slugArg = a;
    }
  }
  if (!slugArg) {
    console.error("Usage: haziq read <slug|url> [--html]");
    process.exitCode = 2;
    return;
  }
  const slug = normalizeSlug(slugArg);
  const detail = await apiJson<EssayDetail>(`/v1/essays/${slug}.json`, {
    authenticated: false,
  });

  const fm = [
    "---",
    `title: ${detail.title}`,
    `slug: ${detail.slug}`,
    `date: ${detail.date}`,
    `author: ${detail.author}`,
    `url: ${detail.url}`,
    "---",
    "",
  ].join("\n");

  const body = raw ? detail.body_html : htmlToMarkdown(detail.body_html);

  process.stdout.write(fm);
  process.stdout.write(body);
  if (!body.endsWith("\n")) process.stdout.write("\n");
}

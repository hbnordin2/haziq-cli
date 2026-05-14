/**
 * `haziq read <slug-or-url>` — fetches the essay's JSON representation and
 * prints a frontmatter block + body to stdout. Designed to be piped into
 * Claude Code or Codex.
 *
 * Public endpoint — no auth required. Slug is normalized: a full URL or
 * /essays/<slug> path also works.
 */
import { apiJson } from "../api.js";

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
  const slugArg = args[0];
  if (!slugArg) {
    console.error("Usage: haziq read <slug|url>");
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

  process.stdout.write(fm);
  process.stdout.write(detail.body_html);
  if (!detail.body_html.endsWith("\n")) process.stdout.write("\n");
}

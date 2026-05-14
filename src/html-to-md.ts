/**
 * HTML → markdown for haziqnordin.com essay bodies. Not a general-purpose
 * converter — assumes our well-formed HTML and known structural patterns.
 * Designed to feed AI models something terse and faithful, dropping the
 * cosmetic noise (inline styles, schema.org wrappers, UI chrome) that would
 * otherwise dominate the token budget.
 *
 * Strategy:
 *   1. Drop noise blocks wholesale (script/style, comments, the share-with-AI
 *      aside, the share-this-essay footer).
 *   2. Walk recognised block tags and emit markdown equivalents.
 *   3. For inline runs, convert a small set of tags then strip the rest.
 *   4. Collapse whitespace and trailing blank lines.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, ref: string) => {
    if (ref.startsWith("#")) {
      const hex = ref[1] === "x" || ref[1] === "X";
      const num = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(num)) return String.fromCodePoint(num);
      return full;
    }
    return ENTITIES[ref.toLowerCase()] ?? full;
  });
}

/** Strip every tag, decode entities, collapse whitespace. For inline runs. */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** Convert inline tags (a, em, strong, code, br) but strip everything else. */
function inlineMd(html: string): string {
  let s = html;
  // links: <a href="X">text</a> → [text](X)
  s = s.replace(
    /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, text: string) => `[${plainText(text)}](${href})`,
  );
  // <br> → newline
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // emphasis
  s = s.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, t: string) => `**${plainText(t)}**`);
  s = s.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, t: string) => `*${plainText(t)}*`);
  // inline code
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t: string) => `\`${plainText(t)}\``);
  // strip everything else, keep inner text
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // collapse runs of whitespace but preserve newlines from <br>
  s = s.replace(/[ \t]+/g, " ");
  return s.trim();
}

interface Drop {
  open: RegExp;
  close: string;
}

const DROP_BLOCKS: Drop[] = [
  { open: /<script\b[^>]*>/i, close: "</script>" },
  { open: /<style\b[^>]*>/i, close: "</style>" },
  { open: /<noscript\b[^>]*>/i, close: "</noscript>" },
  // share-with-AI aside (the button row injected by build.ts)
  { open: /<aside\b[^>]*class=["'][^"']*\bread-with-ai\b[^"']*["'][^>]*>/i, close: "</aside>" },
  // essay-share footer (X / LinkedIn / copy-link row)
  { open: /<footer\b[^>]*class=["'][^"']*\bessay-share\b[^"']*["'][^>]*>/i, close: "</footer>" },
];

/** Strip noise blocks before content extraction. */
function stripNoise(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  for (const { open, close } of DROP_BLOCKS) {
    while (true) {
      const m = open.exec(s);
      if (!m) break;
      const end = s.toLowerCase().indexOf(close, m.index + m[0].length);
      if (end === -1) break;
      s = s.slice(0, m.index) + s.slice(end + close.length);
    }
  }
  return s;
}

/** Pull the next block tag opening at or after `i`. Returns null at end. */
function nextBlock(html: string, i: number): {
  start: number;
  end: number;
  tag: string;
  attrs: string;
  text: string;
} | null {
  const blockRe =
    /<(h[1-6]|p|ul|ol|blockquote|pre|hr|figure|figcaption|img|article|section|div|header|main|aside|footer)\b([^>]*)>/gi;
  blockRe.lastIndex = i;
  const m = blockRe.exec(html);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const attrs = m[2] ?? "";
  const open = m.index;
  const afterOpen = open + m[0].length;
  if (tag === "hr" || tag === "img") {
    return { start: open, end: afterOpen, tag, attrs, text: "" };
  }
  const close = `</${tag}>`;
  // Match nested same-tag pairs so we don't terminate early.
  let depth = 1;
  let scan = afterOpen;
  while (depth > 0) {
    const lowered = html.toLowerCase();
    const nextOpen = lowered.indexOf(`<${tag}`, scan);
    const nextClose = lowered.indexOf(close, scan);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      scan = nextOpen + tag.length + 1;
    } else {
      depth--;
      scan = nextClose + close.length;
      if (depth === 0) {
        return {
          start: open,
          end: scan,
          tag,
          attrs,
          text: html.slice(afterOpen, nextClose),
        };
      }
    }
  }
  return null;
}

function attrValue(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}=["']([^"']*)["']`, "i");
  const m = re.exec(attrs);
  return m ? m[1] : null;
}

function emitList(html: string, ordered: boolean): string {
  const items: string[] = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  let n = 1;
  while ((m = liRe.exec(html)) !== null) {
    const inner = inlineMd(m[1]).replace(/\n/g, " ");
    const marker = ordered ? `${n}.` : "-";
    items.push(`${marker} ${inner}`);
    n++;
  }
  return items.join("\n");
}

function emitCodeBlock(html: string): string {
  // <pre><code>…</code></pre> or just <pre>…</pre>
  const codeMatch = /<code\b[^>]*>([\s\S]*?)<\/code>/i.exec(html);
  const raw = codeMatch ? codeMatch[1] : html;
  const text = decodeEntities(raw.replace(/<[^>]+>/g, ""));
  return "```\n" + text.replace(/\n+$/, "") + "\n```";
}

function emitBlock(b: { tag: string; attrs: string; text: string }): string | null {
  const { tag, attrs, text } = b;
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag[1]);
      return `${"#".repeat(level)} ${plainText(text)}`;
    }
    case "p": {
      const md = inlineMd(text);
      return md.length ? md : null;
    }
    case "ul":
      return emitList(text, false);
    case "ol":
      return emitList(text, true);
    case "blockquote": {
      const inner = walk(text).trim();
      if (!inner) return null;
      return inner
        .split("\n")
        .map((line) => (line.length ? `> ${line}` : ">"))
        .join("\n");
    }
    case "pre":
      return emitCodeBlock(text);
    case "hr":
      return "---";
    case "img": {
      const alt = attrValue(attrs, "alt") ?? "";
      const src = attrValue(attrs, "src") ?? "";
      if (!src) return null;
      return `![${alt}](${src})`;
    }
    case "figure": {
      // Pull out the img and figcaption separately.
      const inner = walk(text).trim();
      return inner.length ? inner : null;
    }
    case "figcaption": {
      const md = inlineMd(text);
      return md.length ? `*${md}*` : null;
    }
    case "article":
    case "section":
    case "div":
    case "header":
    case "main":
    case "aside":
    case "footer": {
      // Component mount points are empty divs with id/data-* attrs.
      const stripped = text.replace(/\s+/g, "");
      if (!stripped) return null;
      const inner = walk(text).trim();
      return inner.length ? inner : null;
    }
    default:
      return null;
  }
}

function walk(html: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < html.length) {
    const block = nextBlock(html, i);
    if (!block) {
      const tail = inlineMd(html.slice(i));
      if (tail.length) out.push(tail);
      break;
    }
    if (block.start > i) {
      const between = inlineMd(html.slice(i, block.start));
      if (between.length) out.push(between);
    }
    const md = emitBlock(block);
    if (md != null && md.length) out.push(md);
    i = block.end;
  }
  return out.join("\n\n");
}

export function htmlToMarkdown(html: string): string {
  const cleaned = stripNoise(html);
  const md = walk(cleaned);
  // Collapse 3+ blank lines down to 2; trim trailing whitespace per line.
  return md
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

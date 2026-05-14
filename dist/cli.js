#!/usr/bin/env node

// src/commands/login.ts
import { createServer } from "node:http";
import { exec, spawn } from "node:child_process";

// src/config.ts
var SITE_URL = process.env.HAZIQ_SITE_URL || "https://haziqnordin.com";
var AUTH_DOMAIN = process.env.HAZIQ_AUTH_DOMAIN || "auth.haziqnordin.com";
var CLIENT_ID = process.env.HAZIQ_CLI_CLIENT_ID || "dktaa24vs2h0u0h3hbne15h73";
var CALLBACK_PORTS = [7263, 8765, 9876, 14552];
var CALLBACK_PATH = "/callback";

// src/auth.ts
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function configDir() {
  return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "haziq") : join(homedir(), ".config", "haziq");
}
function tokensPath() {
  return join(configDir(), "tokens.json");
}
async function saveTokens(t) {
  await mkdir(configDir(), { recursive: true });
  await writeFile(tokensPath(), JSON.stringify(t, null, 2), "utf-8");
  await chmod(tokensPath(), 384);
}
async function loadTokens() {
  const p = tokensPath();
  if (!existsSync(p))
    return null;
  try {
    return JSON.parse(await readFile(p, "utf-8"));
  } catch {
    return null;
  }
}
async function clearTokens() {
  const p = tokensPath();
  if (existsSync(p))
    await rm(p);
}
function decodeIdToken(idToken) {
  try {
    const payload = idToken.split(".")[1];
    if (!payload)
      return null;
    const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
    const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const claims = JSON.parse(json);
    return {
      sub: String(claims.sub ?? ""),
      email: String(claims.email ?? ""),
      name: typeof claims.name === "string" ? claims.name : undefined,
      exp: Number(claims.exp ?? 0)
    };
  } catch {
    return null;
  }
}
function b64url(b) {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeVerifier() {
  return b64url(randomBytes(48));
}
function makeChallenge(verifier) {
  return b64url(createHash("sha256").update(verifier).digest());
}
function makeState() {
  return b64url(randomBytes(16));
}
async function getFreshIdToken() {
  const t = await loadTokens();
  if (!t)
    return null;
  const now = Math.floor(Date.now() / 1000);
  const safeUntil = (t.expires_at ?? 0) - 60;
  if (safeUntil > now)
    return t.id_token;
  if (!t.refresh_token)
    return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: t.refresh_token
  });
  const res = await fetch(`https://${AUTH_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok)
    return null;
  const data = await res.json();
  const next = {
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: t.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in
  };
  await saveTokens(next);
  return next.id_token;
}

// src/commands/login.ts
async function pickPort() {
  for (const port of CALLBACK_PORTS) {
    const server = createServer();
    const opened = await new Promise((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (opened)
      return { port, server };
  }
  throw new Error(`Couldn't bind any of these ports: ${CALLBACK_PORTS.join(", ")}. Close whatever's using them and try again.`);
}
function openBrowser(url) {
  const platform = process.platform;
  if (platform === "darwin")
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  else if (platform === "win32")
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
  else
    exec(`xdg-open "${url}"`, () => {
      return;
    });
}
function waitForCallback(server, expectedState, port) {
  return new Promise((resolve, reject) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(htmlPage(`Sign-in failed: ${escapeHtml(error)}`));
        reject(new Error(`sign-in failed: ${error}`));
        return;
      }
      if (!code || !state) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(htmlPage("Missing code or state."));
        reject(new Error("missing code or state"));
        return;
      }
      if (state !== expectedState) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(htmlPage("State mismatch — possible CSRF. Try again."));
        reject(new Error("state mismatch"));
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(htmlPage("You're signed in. You can close this tab."));
      resolve({ code, state });
    });
  });
}
function htmlPage(message) {
  return `<!doctype html><meta charset="utf-8"><title>haziq-cli</title>
<style>
  html,body { margin:0; padding:0; background:#0c0d10; color:#f5f4ef; font-family:-apple-system,system-ui,sans-serif; }
  .wrap { max-width:480px; margin:120px auto; padding:32px; background:#15171b; border:1px solid #2a2c30; border-radius:8px; text-align:center; }
  .accent { color:#ff6b3d; }
</style>
<div class="wrap"><h1 class="accent">haziq-cli</h1><p>${message}</p></div>`;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function login() {
  const verifier = makeVerifier();
  const challenge = makeChallenge(verifier);
  const state = makeState();
  const { port, server } = await pickPort();
  const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    identity_provider: "Google"
  });
  const authorizeUrl = `https://${AUTH_DOMAIN}/oauth2/authorize?${params.toString()}`;
  console.log("Opening your browser to sign in with Google…");
  console.log(`If it didn't open: ${authorizeUrl}
`);
  openBrowser(authorizeUrl);
  const callbackPromise = waitForCallback(server, state, port);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for sign-in.")), 5 * 60 * 1000));
  let result;
  try {
    result = await Promise.race([callbackPromise, timeout]);
  } finally {
    server.close();
  }
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: result.code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  const tokenRes = await fetch(`https://${AUTH_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString()
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
  }
  const data = await tokenRes.json();
  const tokens = {
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in
  };
  await saveTokens(tokens);
  const claims = decodeIdToken(tokens.id_token);
  if (claims) {
    console.log(`Signed in as ${claims.name ?? claims.email}.`);
  } else {
    console.log("Signed in.");
  }
}

// src/commands/logout.ts
async function logout() {
  const had = await loadTokens() !== null;
  await clearTokens();
  console.log(had ? "Signed out." : "Already signed out.");
}

// src/commands/whoami.ts
async function whoami() {
  const t = await loadTokens();
  if (!t) {
    console.log("Not signed in. Run: haziq login");
    process.exitCode = 1;
    return;
  }
  const claims = decodeIdToken(t.id_token);
  if (!claims) {
    console.log("Token unreadable. Run: haziq login");
    process.exitCode = 1;
    return;
  }
  const expSec = Math.max(0, claims.exp - Math.floor(Date.now() / 1000));
  console.log(`${claims.name ?? "(no name)"} <${claims.email}>`);
  console.log(`sub:    ${claims.sub}`);
  console.log(`token:  ${expSec > 0 ? `valid for ${expSec}s` : "expired (will refresh on next request)"}`);
}

// src/api.ts
class AuthRequired extends Error {
  constructor() {
    super("Sign in first: haziq login");
    this.name = "AuthRequired";
  }
}

class ApiError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}
async function apiFetch(path, init = {}) {
  const { authenticated = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (authenticated) {
    const token = await getFreshIdToken();
    if (!token)
      throw new AuthRequired;
    headers.set("authorization", `Bearer ${token}`);
  }
  const url = path.startsWith("http") ? path : `${SITE_URL}${path}`;
  return fetch(url, { ...rest, headers });
}
async function apiJson(path, init = {}) {
  const res = await apiFetch(path, init);
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "error" in body && typeof body.error === "string" ? String(body.error) : null) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return body;
}

// src/html-to-md.ts
var ENTITIES = {
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
  ldquo: "“"
};
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, ref) => {
    if (ref.startsWith("#")) {
      const hex = ref[1] === "x" || ref[1] === "X";
      const num = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(num))
        return String.fromCodePoint(num);
      return full;
    }
    return ENTITIES[ref.toLowerCase()] ?? full;
  });
}
function plainText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
function inlineMd(html) {
  let s = html;
  s = s.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${plainText(text)}](${href})`);
  s = s.replace(/<br\s*\/?>/gi, `
`);
  s = s.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, t) => `**${plainText(t)}**`);
  s = s.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, t) => `*${plainText(t)}*`);
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${plainText(t)}\``);
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/[ \t]+/g, " ");
  return s.trim();
}
var DROP_BLOCKS = [
  { open: /<script\b[^>]*>/i, close: "</script>" },
  { open: /<style\b[^>]*>/i, close: "</style>" },
  { open: /<noscript\b[^>]*>/i, close: "</noscript>" },
  { open: /<aside\b[^>]*class=["'][^"']*\bread-with-ai\b[^"']*["'][^>]*>/i, close: "</aside>" },
  { open: /<footer\b[^>]*class=["'][^"']*\bessay-share\b[^"']*["'][^>]*>/i, close: "</footer>" }
];
function stripNoise(html) {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  for (const { open, close } of DROP_BLOCKS) {
    while (true) {
      const m = open.exec(s);
      if (!m)
        break;
      const end = s.toLowerCase().indexOf(close, m.index + m[0].length);
      if (end === -1)
        break;
      s = s.slice(0, m.index) + s.slice(end + close.length);
    }
  }
  return s;
}
function nextBlock(html, i) {
  const blockRe = /<(h[1-6]|p|ul|ol|blockquote|pre|hr|figure|figcaption|img|article|section|div|header|main|aside|footer)\b([^>]*)>/gi;
  blockRe.lastIndex = i;
  const m = blockRe.exec(html);
  if (!m)
    return null;
  const tag = m[1].toLowerCase();
  const attrs = m[2] ?? "";
  const open = m.index;
  const afterOpen = open + m[0].length;
  if (tag === "hr" || tag === "img") {
    return { start: open, end: afterOpen, tag, attrs, text: "" };
  }
  const close = `</${tag}>`;
  let depth = 1;
  let scan = afterOpen;
  while (depth > 0) {
    const lowered = html.toLowerCase();
    const nextOpen = lowered.indexOf(`<${tag}`, scan);
    const nextClose = lowered.indexOf(close, scan);
    if (nextClose === -1)
      return null;
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
          text: html.slice(afterOpen, nextClose)
        };
      }
    }
  }
  return null;
}
function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}=["']([^"']*)["']`, "i");
  const m = re.exec(attrs);
  return m ? m[1] : null;
}
function emitList(html, ordered) {
  const items = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  let n = 1;
  while ((m = liRe.exec(html)) !== null) {
    const inner = inlineMd(m[1]).replace(/\n/g, " ");
    const marker = ordered ? `${n}.` : "-";
    items.push(`${marker} ${inner}`);
    n++;
  }
  return items.join(`
`);
}
function emitCodeBlock(html) {
  const codeMatch = /<code\b[^>]*>([\s\S]*?)<\/code>/i.exec(html);
  const raw = codeMatch ? codeMatch[1] : html;
  const text = decodeEntities(raw.replace(/<[^>]+>/g, ""));
  return "```\n" + text.replace(/\n+$/, "") + "\n```";
}
function emitBlock(b) {
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
      if (!inner)
        return null;
      return inner.split(`
`).map((line) => line.length ? `> ${line}` : ">").join(`
`);
    }
    case "pre":
      return emitCodeBlock(text);
    case "hr":
      return "---";
    case "img": {
      const alt = attrValue(attrs, "alt") ?? "";
      const src = attrValue(attrs, "src") ?? "";
      if (!src)
        return null;
      return `![${alt}](${src})`;
    }
    case "figure": {
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
      const stripped = text.replace(/\s+/g, "");
      if (!stripped)
        return null;
      const inner = walk(text).trim();
      return inner.length ? inner : null;
    }
    default:
      return null;
  }
}
function walk(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    const block = nextBlock(html, i);
    if (!block) {
      const tail = inlineMd(html.slice(i));
      if (tail.length)
        out.push(tail);
      break;
    }
    if (block.start > i) {
      const between = inlineMd(html.slice(i, block.start));
      if (between.length)
        out.push(between);
    }
    const md = emitBlock(block);
    if (md != null && md.length)
      out.push(md);
    i = block.end;
  }
  return out.join(`

`);
}
function htmlToMarkdown(html) {
  const cleaned = stripNoise(html);
  const md = walk(cleaned);
  return md.split(`
`).map((line) => line.replace(/[ \t]+$/, "")).join(`
`).replace(/\n{3,}/g, `

`).trim();
}

// src/commands/read.ts
function normalizeSlug(input) {
  let s = input.trim();
  try {
    if (s.startsWith("http")) {
      s = new URL(s).pathname;
    }
  } catch {}
  s = s.replace(/^\/+/, "").replace(/\/+$/, "");
  s = s.replace(/^essays\//, "");
  s = s.replace(/\.(html|json)$/i, "");
  return s;
}
async function read(args) {
  let slugArg = null;
  let raw = false;
  for (const a of args) {
    if (a === "--html" || a === "--raw")
      raw = true;
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
  const detail = await apiJson(`/v1/essays/${slug}.json`, {
    authenticated: false
  });
  const fm = [
    "---",
    `title: ${detail.title}`,
    `slug: ${detail.slug}`,
    `date: ${detail.date}`,
    `author: ${detail.author}`,
    `url: ${detail.url}`,
    "---",
    ""
  ].join(`
`);
  const body = raw ? detail.body_html : htmlToMarkdown(detail.body_html);
  process.stdout.write(fm);
  process.stdout.write(body);
  if (!body.endsWith(`
`))
    process.stdout.write(`
`);
}

// src/commands/comment.ts
import { readFile as readFile2 } from "node:fs/promises";
function parseArgs(args) {
  let slug = null;
  let body = null;
  let fromFile = null;
  let parent = null;
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    if (a === "--body")
      body = args[++i] ?? null;
    else if (a === "--from-file")
      fromFile = args[++i] ?? null;
    else if (a === "--parent")
      parent = args[++i] ?? null;
    else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else if (!slug) {
      slug = a;
    }
  }
  return { slug, body, fromFile, parent };
}
async function readStdin() {
  if (process.stdin.isTTY)
    return "";
  const chunks = [];
  for await (const c of process.stdin)
    chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf-8");
}
async function comment(args) {
  const parsed = parseArgs(args);
  if (!parsed.slug) {
    console.error('Usage: haziq comment <slug> [--body "..."] [--from-file PATH] [--parent COMMENT_ID]');
    process.exitCode = 2;
    return;
  }
  let body = parsed.body;
  if (!body && parsed.fromFile) {
    body = (await readFile2(parsed.fromFile, "utf-8")).trim();
  }
  if (!body) {
    body = (await readStdin()).trim();
  }
  if (!body) {
    console.error("No comment body. Pass --body, --from-file, or pipe via stdin.");
    process.exitCode = 2;
    return;
  }
  const payload = { slug: parsed.slug, body, parent_id: parsed.parent };
  try {
    const res = await apiJson("/v1/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
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

// src/commands/subscribe.ts
async function subscribe() {
  try {
    const res = await apiJson("/v1/subscribe", { method: "POST" });
    console.log(res.message ?? "You're subscribed.");
  } catch (err) {
    if (err instanceof AuthRequired) {
      console.error("Sign in first: haziq login");
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

// src/cli.ts
var HELP = `haziq — CLI for haziqnordin.com

Usage:
  haziq login                       Sign in with Google (opens browser)
  haziq logout                      Forget local tokens
  haziq whoami                      Show the current user
  haziq read <slug|url>             Print an essay's frontmatter + body
  haziq comment <slug> [opts]       Post a comment on an essay
                                      --body "..."      inline body
                                      --from-file PATH  read body from file
                                      --parent ID       reply to a comment
                                      (or pipe body via stdin)
  haziq subscribe                   Subscribe the signed-in user to the
                                    newsletter
  haziq --version                   Print version
  haziq --help                      This message
`;
async function main() {
  const argv = process.argv.slice(2);
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(`haziq 0.1.0
`);
    return;
  }
  switch (cmd) {
    case "login":
      await login();
      return;
    case "logout":
      await logout();
      return;
    case "whoami":
      await whoami();
      return;
    case "read":
      await read(rest);
      return;
    case "comment":
      await comment(rest);
      return;
    case "subscribe":
      await subscribe();
      return;
    default:
      console.error(`Unknown command: ${cmd}
`);
      process.stdout.write(HELP);
      process.exitCode = 2;
  }
}
main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`haziq: ${msg}`);
  process.exitCode = 1;
});

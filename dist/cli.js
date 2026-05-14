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
  const slugArg = args[0];
  if (!slugArg) {
    console.error("Usage: haziq read <slug|url>");
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
  process.stdout.write(fm);
  process.stdout.write(detail.body_html);
  if (!detail.body_html.endsWith(`
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

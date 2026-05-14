/**
 * Token storage + PKCE helpers. Tokens live in
 * $XDG_CONFIG_HOME/haziq/tokens.json (defaults to ~/.config/haziq/tokens.json)
 * with mode 0600. We refresh on demand when the id_token is within 60s of
 * expiry; if the refresh fails the user is prompted to sign in again.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AUTH_DOMAIN, CLIENT_ID } from "./config.js";

export interface Tokens {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

export interface IdClaims {
  sub: string;
  email: string;
  name?: string;
  exp: number;
}

function configDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "haziq")
    : join(homedir(), ".config", "haziq");
}

function tokensPath(): string {
  return join(configDir(), "tokens.json");
}

export async function saveTokens(t: Tokens): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(tokensPath(), JSON.stringify(t, null, 2), "utf-8");
  await chmod(tokensPath(), 0o600);
}

export async function loadTokens(): Promise<Tokens | null> {
  const p = tokensPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, "utf-8")) as Tokens;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  const p = tokensPath();
  if (existsSync(p)) await rm(p);
}

export function decodeIdToken(idToken: string): IdClaims | null {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const claims = JSON.parse(json) as Record<string, unknown>;
    return {
      sub: String(claims.sub ?? ""),
      email: String(claims.email ?? ""),
      name: typeof claims.name === "string" ? claims.name : undefined,
      exp: Number(claims.exp ?? 0),
    };
  } catch {
    return null;
  }
}

// --- PKCE helpers ----------------------------------------------------------

export function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makeVerifier(): string {
  return b64url(randomBytes(48));
}

export function makeChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function makeState(): string {
  return b64url(randomBytes(16));
}

// --- Token refresh ---------------------------------------------------------

/**
 * Returns a usable id_token, refreshing if needed. Returns null when the
 * user must sign in again (no refresh token, refresh failed, etc.).
 */
export async function getFreshIdToken(): Promise<string | null> {
  const t = await loadTokens();
  if (!t) return null;
  const now = Math.floor(Date.now() / 1000);
  const safeUntil = (t.expires_at ?? 0) - 60;
  if (safeUntil > now) return t.id_token;

  if (!t.refresh_token) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: t.refresh_token,
  });
  const res = await fetch(`https://${AUTH_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    id_token: string;
    access_token: string;
    expires_in: number;
  };
  const next: Tokens = {
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: t.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  };
  await saveTokens(next);
  return next.id_token;
}

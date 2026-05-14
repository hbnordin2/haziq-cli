/**
 * `haziq login` — browser PKCE flow.
 *
 *   1. Pick a free port from the pre-registered list (Cognito doesn't
 *      accept wildcard redirect URIs).
 *   2. Spin up an HTTP server on that port.
 *   3. Open the user's browser to Cognito's /oauth2/authorize, asking it
 *      to send the user back to http://localhost:PORT/callback.
 *   4. Exchange code for tokens, persist them, and reply to the browser
 *      with a "you can close this tab" page.
 */
import { createServer, type Server } from "node:http";
import { exec, spawn } from "node:child_process";
import { AUTH_DOMAIN, CLIENT_ID, CALLBACK_PATH, CALLBACK_PORTS } from "../config.js";
import {
  makeChallenge,
  makeState,
  makeVerifier,
  saveTokens,
  decodeIdToken,
  type Tokens,
} from "../auth.js";

interface CallbackResult {
  code: string;
  state: string;
}

async function pickPort(): Promise<{ port: number; server: Server }> {
  for (const port of CALLBACK_PORTS) {
    const server = createServer();
    const opened = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (opened) return { port, server };
  }
  throw new Error(
    `Couldn't bind any of these ports: ${CALLBACK_PORTS.join(", ")}. Close whatever's using them and try again.`,
  );
}

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  else if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
  else exec(`xdg-open "${url}"`, () => undefined);
}

function waitForCallback(server: Server, expectedState: string, port: number): Promise<CallbackResult> {
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

function htmlPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>haziq-cli</title>
<style>
  html,body { margin:0; padding:0; background:#0c0d10; color:#f5f4ef; font-family:-apple-system,system-ui,sans-serif; }
  .wrap { max-width:480px; margin:120px auto; padding:32px; background:#15171b; border:1px solid #2a2c30; border-radius:8px; text-align:center; }
  .accent { color:#ff6b3d; }
</style>
<div class="wrap"><h1 class="accent">haziq-cli</h1><p>${message}</p></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function login(): Promise<void> {
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
    identity_provider: "Google",
  });
  const authorizeUrl = `https://${AUTH_DOMAIN}/oauth2/authorize?${params.toString()}`;

  console.log("Opening your browser to sign in with Google…");
  console.log(`If it didn't open: ${authorizeUrl}\n`);
  openBrowser(authorizeUrl);

  const callbackPromise = waitForCallback(server, state, port);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Timed out waiting for sign-in.")), 5 * 60 * 1000),
  );
  let result: CallbackResult;
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
    code_verifier: verifier,
  });
  const tokenRes = await fetch(`https://${AUTH_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
  }
  const data = (await tokenRes.json()) as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  const tokens: Tokens = {
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  };
  await saveTokens(tokens);
  const claims = decodeIdToken(tokens.id_token);
  if (claims) {
    console.log(`Signed in as ${claims.name ?? claims.email}.`);
  } else {
    console.log("Signed in.");
  }
}

import { decodeIdToken, loadTokens } from "../auth.js";

export async function whoami(): Promise<void> {
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

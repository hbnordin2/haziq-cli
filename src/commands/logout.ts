import { clearTokens, loadTokens } from "../auth.js";

export async function logout(): Promise<void> {
  const had = (await loadTokens()) !== null;
  await clearTokens();
  console.log(had ? "Signed out." : "Already signed out.");
}

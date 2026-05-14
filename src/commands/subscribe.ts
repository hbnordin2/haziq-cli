import { apiJson, AuthRequired } from "../api.js";

interface SubscribeResponse {
  ok?: boolean;
  message?: string;
  newsletter_status?: string;
}

export async function subscribe(): Promise<void> {
  try {
    const res = await apiJson<SubscribeResponse>("/v1/subscribe", { method: "POST" });
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

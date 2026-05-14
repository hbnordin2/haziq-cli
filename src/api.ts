/**
 * Tiny fetch wrapper for the haziqnordin.com API. Always attaches the
 * current id_token, refreshing transparently when needed.
 */
import { SITE_URL } from "./config.js";
import { getFreshIdToken } from "./auth.js";

export class AuthRequired extends Error {
  constructor() {
    super("Sign in first: haziq login");
    this.name = "AuthRequired";
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export async function apiFetch(
  path: string,
  init: RequestInit & { authenticated?: boolean } = {},
): Promise<Response> {
  const { authenticated = true, ...rest } = init;
  const headers = new Headers(rest.headers);

  if (authenticated) {
    const token = await getFreshIdToken();
    if (!token) throw new AuthRequired();
    headers.set("authorization", `Bearer ${token}`);
  }

  const url = path.startsWith("http") ? path : `${SITE_URL}${path}`;
  return fetch(url, { ...rest, headers });
}

export async function apiJson<T = unknown>(
  path: string,
  init: RequestInit & { authenticated?: boolean } = {},
): Promise<T> {
  const res = await apiFetch(path, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through to status check
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "error" in body && typeof (body as Record<string, unknown>).error === "string"
        ? String((body as Record<string, unknown>).error)
        : null) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

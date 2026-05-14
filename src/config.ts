/**
 * Build-time config. Bun's bundler inlines literal `process.env.*` reads via
 * `--define`, so these resolve to constants in the published binary. Run-time
 * overrides via real env vars still win at the top of each constant.
 */
export const SITE_URL = process.env.HAZIQ_SITE_URL || "https://haziqnordin.com";
export const AUTH_DOMAIN = process.env.HAZIQ_AUTH_DOMAIN || "auth.haziqnordin.com";
export const CLIENT_ID = process.env.HAZIQ_CLI_CLIENT_ID || "dktaa24vs2h0u0h3hbne15h73";

/**
 * Cognito doesn't allow wildcard redirect URIs, so the CLI client has a
 * fixed set of localhost ports pre-registered. The login command tries each
 * in order, falling back when a port is already bound.
 */
export const CALLBACK_PORTS = [7263, 8765, 9876, 14552];
export const CALLBACK_PATH = "/callback";

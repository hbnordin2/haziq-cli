/**
 * haziq-cli entry. Dispatches to commands and renders errors. Tiny
 * hand-rolled arg loop — adding a framework would more than double the
 * shipping bundle.
 */
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { whoami } from "./commands/whoami.js";
import { read } from "./commands/read.js";
import { comment } from "./commands/comment.js";
import { subscribe } from "./commands/subscribe.js";

const HELP = `haziq — CLI for haziqnordin.com

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write("haziq 0.1.0\n");
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
      console.error(`Unknown command: ${cmd}\n`);
      process.stdout.write(HELP);
      process.exitCode = 2;
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`haziq: ${msg}`);
  process.exitCode = 1;
});

# haziq

CLI for [haziqnordin.com](https://haziqnordin.com). Built to be driven from Claude Code or Codex — read essays, leave comments, subscribe, all from the terminal.

## Install

Run without installing (recommended):

```sh
npx github:hbnordin2/haziq-cli <command>
```

Or install globally:

```sh
npm install -g github:hbnordin2/haziq-cli
```

(The package isn't on the public npm registry yet — install directly off GitHub for now.)

## Sign in

```sh
haziq login
```

Opens your browser to sign in with Google. Tokens land in `~/.config/haziq/tokens.json` (mode 0600). Refreshes automatically.

## Commands

```
haziq login                       Sign in with Google
haziq logout                      Forget local tokens
haziq whoami                      Show the current user
haziq read <slug|url>             Print essay frontmatter + body
haziq comment <slug> [opts]       Post a comment
                                    --body "..."      inline
                                    --from-file PATH  from file
                                    --parent ID       reply to a comment
                                    (or pipe via stdin)
haziq subscribe                   Subscribe to the newsletter
```

## Example: read with an AI

```sh
haziq read 2026-05-13-what-is-taste | pbcopy
# then paste into Claude/Codex
```

Or, inline:

```sh
claude "Summarize this essay: $(haziq read 2026-05-13-what-is-taste)"
```

## Leaving a comment

```sh
haziq comment 2026-05-13-what-is-taste --body "Loved the recipe-card framing."
```

Comments are moderated — they show up once approved.

## Dev

```sh
bun install
bun run typecheck
bun run build
node dist/cli.js --help
```

## License

MIT

# Figma Semantic Bridge

Local-first semantic notes for Figma selections. Give UI regions names and an ordered hierarchy, link Spec regions to one or more UI regions, and give that structure and its Figma references to a coding agent. Bridge does not generate code or reconstruct the Figma document.

v0.5 is a replacement for v0.4 and does not migrate its data; v0.4 remains available in the release history. Some live acceptance checks remain open; see the [verification status](docs/v05-validation.md) and [backlog](docs/v05-backlog.md).

## Start

Requires Node.js 22 or later and a Figma personal access token with **file_content:read**. A token can read content from files accessible to its account.

```sh
git clone --branch v0.5.0 https://github.com/neocjmix/figma-semantic-bridge.git
cd figma-semantic-bridge
npm ci
npm run build
npm start
```

Open the printed loopback URL (`http://127.0.0.1:4180` by default). Enter your token, then create or select a workspace. Drag **Send from Figma** onto the browser bookmarks bar. In Figma web Dev Mode, select a layer and click the bookmark; choose UI or Spec in Bridge.

Canvas groups regions by file and page; select a region to name it. Regions lets you organize the UI tree and drag a Spec onto a UI region; the Spec remains in its catalog. Use the parent and Spec selectors as keyboard alternatives. Changes save automatically. Export JSON from the header.

If another window changes the workspace first, saving stops instead of overwriting it. Copy any unsaved text shown in the window before using Reload. Only one server can open a data directory at a time; stop an older server before starting the updated version.

The server saves v0.5 workspaces separately in `~/.figma-semantic-bridge-v05`. The token is kept in a separate local file with mode `0600`; it is never part of export or MCP output. `FSB_V05_DATA_DIR` overrides the data directory, and `FIGMA_TOKEN` supplies a server-side token override. `PORT` changes the loopback port; regenerate the bookmark after changing it. Never place a token in a URL or commit one.

## MCP

Build first, then configure a stdio MCP client with Node and the absolute path to `dist/mcp.mjs`. The `list_workspaces` and `get_workspace` tools expose the same semantic data as JSON. Set `FSB_V05_DATA_DIR` for MCP if the server uses a non-default data directory. Use a separate Figma MCP to retrieve the source nodes using their exported file and node IDs.

For example, in a client that accepts `mcpServers` configuration:

```json
{
  "mcpServers": {
    "figma-semantic-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/figma-semantic-bridge/dist/mcp.mjs"]
    }
  }
}
```

## Checks

```sh
npm run check
```

Tests with controlled Figma responses are separate from actual Figma web/REST/MCP acceptance. See the [replacement plan](docs/plans/v0.5.0-replacement.md), [task acceptance](docs/plans/v0.5.0-task-acceptance.md), and [current evidence](docs/v05-validation.md).

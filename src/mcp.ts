import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { init, readStore } from "./storage.js";
import { exportWorkspace } from "./model.js";
await init();
const server = new McpServer({
  name: "figma-semantic-bridge",
  version: "0.5.0",
});
server.registerTool(
  "list_workspaces",
  { description: "List semantic workspaces", inputSchema: {} },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          (await readStore()).workspaces.map(({ id, name }) => ({ id, name })),
        ),
      },
    ],
  }),
);
server.registerTool(
  "get_workspace",
  {
    description:
      "Read semantic names, UI hierarchy, Spec relations and Figma references. Source design data is retrieved separately through Figma MCP.",
    inputSchema: { workspaceId: z.string() },
  },
  async ({ workspaceId }) => {
    const w = (await readStore()).workspaces.find((x) => x.id === workspaceId);
    return {
      content: [
        {
          type: "text",
          text: w
            ? JSON.stringify(exportWorkspace(w))
            : JSON.stringify({ error: "Workspace not found" }),
        },
      ],
      isError: !w,
    };
  },
);
await server.connect(new StdioServerTransport());

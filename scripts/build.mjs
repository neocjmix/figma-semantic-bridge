import { build } from "esbuild";
await build({
  entryPoints: ["src/server.ts", "src/mcp.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  outExtension: { ".js": ".mjs" },
});

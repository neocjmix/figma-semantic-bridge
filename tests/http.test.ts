import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const port = 43000 + Math.floor(Math.random() * 1000),
  root = `http://127.0.0.1:${port}`;
let dir: string, proc: ChildProcess;
async function start() {
  proc = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./tests/mock-figma.mjs", "src/server.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), FSB_V05_DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(Error("server start timeout " + output)),
      10000,
    );
    proc.stdout!.on("data", (b) => {
      output += b;
      if (output.includes("Figma Semantic Bridge:")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.stderr!.on("data", (b) => (output += b));
    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(Error("server exited " + code + " " + output));
    });
  });
}
async function stop() {
  if (!proc || proc.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill("SIGTERM");
  });
}
async function req(path: string, method = "GET", data?: unknown) {
  const r = await fetch(root + path, {
    method,
    headers:
      method === "GET"
        ? {}
        : { origin: root, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: r.status, data: await r.json() };
}
test("HTTP and MCP preserve the semantic user workflow across restart", async () => {
  dir = await mkdtemp(join(tmpdir(), "fsb-v05-test-"));
  try {
    await start();
    assert.equal((await req("/api/status")).data.authenticated, false);
    assert.equal((await req("/api/workspaces")).status, 401);
    assert.equal(
      (await req("/api/token", "POST", { token: "bad" })).status,
      401,
    );
    assert.equal(
      (await req("/api/token", "POST", { token: "valid-test-token" })).status,
      200,
    );
    assert.equal((await stat(join(dir, "token"))).mode & 0o777, 0o600);
    const w = (await req("/api/workspaces", "POST", { name: "Project" })).data;
    const prefix = "/api/workspaces/" + w.id;
    const add = async (file: string, id: string, kind: "ui" | "spec") =>
      (
        await req(prefix + "/import", "POST", {
          url: `https://www.figma.com/design/${file}/Test?node-id=${id}`,
          kind,
        })
      ).data;
    let a = await add("file1", "1-1", "ui"),
      b = await add("file2", "2-2", "ui"),
      s = await add("file1", "1-3", "spec");
    assert.ok(a.id && b.id && s.id);
    assert.equal(
      (
        await req(prefix + "/import", "POST", {
          url: "http://evil.example/design/file1/Test?node-id=1-1",
          kind: "ui",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req(prefix + "/import", "POST", {
          url: "https://www.figma.com/design/file1/Test?node-id=99-99",
          kind: "ui",
        })
      ).status,
      404,
    );
    await req(prefix + "/regions/" + a.id, "PATCH", { name: "Header" });
    await req(prefix + "/move", "POST", { id: a.id, parentId: b.id, index: 0 });
    assert.equal(
      (
        await req(prefix + "/move", "POST", {
          id: b.id,
          parentId: a.id,
          index: 0,
        })
      ).status,
      400,
    );
    await req(prefix + "/relations", "POST", { specId: s.id, uiId: a.id });
    await req(prefix + "/relations", "POST", { specId: s.id, uiId: b.id });
    await req(prefix + "/relations", "POST", { specId: s.id, uiId: b.id });
    let exported = (await req(prefix + "/export")).data;
    assert.equal(exported.ui[0].children[0].name, "Header");
    assert.equal(exported.relations.length, 2);
    assert.equal(JSON.stringify(exported).includes("sourceBBox"), false);
    await stop();
    await start();
    assert.equal((await req("/api/status")).data.authenticated, true);
    assert.deepEqual((await req(prefix + "/export")).data, exported);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/mcp.ts"],
      cwd: process.cwd(),
      env: { ...process.env, FSB_V05_DATA_DIR: dir } as Record<string, string>,
    });
    const client = new Client({ name: "test", version: "1" });
    await client.connect(transport);
    const result = await client.callTool({
      name: "get_workspace",
      arguments: { workspaceId: w.id },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.deepEqual(JSON.parse(content[0].text), exported);
    await client.close();
    assert.equal(
      (await readFile(join(dir, "workspaces.json"), "utf8")).includes(
        "valid-test-token",
      ),
      false,
    );
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
test("delayed preview cannot overwrite a resend or a different workspace", async () => {
  dir = await mkdtemp(join(tmpdir(), "fsb-v05-images-"));
  try {
    await start();
    await req("/api/token", "POST", { token: "valid-test-token" });
    const a = (await req("/api/workspaces", "POST", { name: "A" })).data,
      b = (await req("/api/workspaces", "POST", { name: "B" })).data;
    const add = (id: string) =>
      req(`/api/workspaces/${id}/import`, "POST", {
        kind: "ui",
        url: "https://www.figma.com/design/file1/Test?node-id=7-7",
      });
    const first = await add(a.id),
      second = await add(a.id),
      other = await add(b.id);
    assert.equal(first.data.id, second.data.id);
    assert.notEqual(first.data.id, other.data.id);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const aw = (await req(`/api/workspaces/${a.id}`)).data,
      bw = (await req(`/api/workspaces/${b.id}`)).data;
    const lastByte = (preview: string) =>
      Buffer.from(preview.split(",")[1], "base64").at(-1);
    assert.equal(lastByte(aw.regions[0].preview), 2);
    assert.equal(lastByte(bw.regions[0].preview), 3);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});

import http from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import net from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { directory, init, getToken, saveToken, readStore, writeStore } from "./storage.js";
import { validateToken, lookup, image, FigmaError } from "./figma.js";
import {
  newWorkspace,
  figmaReference,
  upsertRegion,
  moveUi,
  link,
  deleteRegion,
  findRegion,
  validBox,
  exportWorkspace,
} from "./model.js";
import type { Store, Workspace, Kind } from "./model.js";
const port = Number(process.env.PORT ?? 4180),
  origin = `http://127.0.0.1:${port}`,
  web = resolve(fileURLToPath(new URL("./web", import.meta.url)));
await init();
// A data directory has one writer, even if different server ports are used.
// The OS releases this loopback reservation when the process exits.
const canonicalDirectory = await realpath(directory);
const lockPort = 49152 + (createHash("sha256").update(canonicalDirectory).digest().readUInt16BE(0) % 16384);
if (lockPort === port) {
  console.error(`Port ${port} is reserved for this data directory. Choose another port.`);
  process.exit(1);
}
const dataLock = net.createServer((socket) => socket.destroy());
try {
  await new Promise<void>((resolve, reject) => {
    dataLock.once("error", reject);
    dataLock.listen(lockPort, "127.0.0.1", () => resolve());
  });
} catch {
  console.error("Another server may be using this data directory. Stop it before starting another.");
  process.exit(1);
}
let store = await readStore(),
  token = await getToken(),
  authenticated = false;
try {
  authenticated = !!token && (await validateToken(token));
} catch {}
let tail = Promise.resolve();
async function mutate<T>(fn: (s: Store) => T): Promise<T> {
  let result: T;
  const task = tail.then(async () => {
    const next: Store = structuredClone(store);
    result = fn(next);
    await writeStore(next);
    store = next;
  });
  tail = task.catch(() => {});
  await task;
  return result!;
}
function workspace(s: Store, id: string) {
  const w = s.workspaces.find((x) => x.id === id);
  if (!w) throw new FigmaError("Workspace not found", 404);
  return w;
}
async function editWorkspace<T>(req: http.IncomingMessage, id: string, fn: (w: Workspace, s: Store) => T) {
  const value = req.headers["if-match"];
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new FigmaError("Reload the workspace before editing.", 428, "REVISION_REQUIRED");
  const expected = Number(value);
  return mutate((s) => {
    const w = workspace(s, id);
    if ((w.revision ?? 0) !== expected)
      throw new FigmaError("This workspace changed in another window. Your unsaved input is still here; copy it before reloading.", 409, "CONFLICT");
    const result = fn(w, s);
    w.revision = expected + 1;
    return { result, revision: w.revision };
  });
}
function json(res: http.ServerResponse, status: number, data: unknown, revision?: number) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(revision === undefined ? {} : { "x-workspace-revision": String(revision) }),
  });
  res.end(JSON.stringify(data));
}
async function body(req: http.IncomingMessage) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new FigmaError("Expected JSON", 415);
  let chunks: Buffer[] = [],
    size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 1024 * 1024) throw new FigmaError("Request too large", 413);
    chunks.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new FigmaError("Invalid JSON");
  }
}
function safeText(v: unknown, max = 500) {
  if (typeof v !== "string" || v.length > max)
    throw new FigmaError("Invalid text");
  return v;
}
function onlyOrigin(req: http.IncomingMessage) {
  if (req.headers.origin !== origin)
    throw new FigmaError("Invalid request origin", 403);
}
async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`)
      throw new FigmaError("Invalid host", 403);
    const u = new URL(req.url ?? "/", origin),
      path = u.pathname,
      method = req.method ?? "GET";
    if (method !== "GET") onlyOrigin(req);
    if (path === "/api/status" && method === "GET")
      return json(res, 200, { authenticated });
    if (path === "/api/token" && method === "POST") {
      const value = safeText((await body(req)).token, 4000).trim();
      if (!(await validateToken(value)))
        throw new FigmaError(
          "Invalid token or missing file access",
          401,
          "TOKEN",
        );
      await saveToken(value);
      token = value;
      authenticated = true;
      return json(res, 200, { ok: true });
    }
    if (path.startsWith("/api/")) {
      if (!authenticated)
        throw new FigmaError("Enter a valid Figma token", 401, "TOKEN");
      if (path === "/api/workspaces" && method === "GET")
        return json(
          res,
          200,
          store.workspaces.map(({ id, name, revision }) => ({ id, name, revision: revision ?? 0 })),
        );
      if (path === "/api/workspaces" && method === "POST") {
        const name = safeText((await body(req)).name, 120).trim();
        if (!name) throw new FigmaError("Enter a workspace name");
        return json(
          res,
          201,
          await mutate((s) => {
            const w = newWorkspace(name);
            s.workspaces.push(w);
            return w;
          }),
        );
      }
      let m = path.match(/^\/api\/workspaces\/([\w-]+)(?:\/(.*))?$/);
      if (!m) throw new FigmaError("Not found", 404);
      const wid = m[1],
        rest = m[2] ?? "";
      if (!rest && method === "GET")
        return json(res, 200, workspace(store, wid));
      if (!rest && method === "DELETE") {
        const edit = await editWorkspace(req, wid, (_w, s) => {
          s.workspaces = s.workspaces.filter((w) => w.id !== wid);
        });
        return json(res, 200, { ok: true }, edit.revision);
      }
      if (rest === "export" && method === "GET")
        return json(res, 200, exportWorkspace(workspace(store, wid)));
      if (rest === "import" && method === "POST") {
        let input = await body(req);
        const kind: Kind = input.kind;
        if (kind !== "ui" && kind !== "spec")
          throw new FigmaError("Choose UI or Spec");
        workspace(store, wid);
        let ref: ReturnType<typeof figmaReference>;
        try {
          ref = figmaReference(safeText(input.url, 4096));
        } catch (e) {
          throw new FigmaError(
            e instanceof Error ? e.message : "Invalid Figma URL",
          );
        }
        let data;
        try {
          data = await lookup(token, ref);
        } catch (e) {
          if (e instanceof FigmaError && e.code === "TOKEN") {
            authenticated = false;
          }
          if (e instanceof FigmaError && e.code === "ACCESS") {
            if (!(await validateToken(token))) {
              authenticated = false;
              throw new FigmaError(
                "Figma token is invalid or expired. Enter it again.",
                401,
                "TOKEN",
              );
            }
            throw new FigmaError(
              "This Figma file is not accessible to your account.",
              403,
              "FILE_ACCESS",
            );
          }
          throw e;
        }
        const edit = await editWorkspace(req, wid, (w) =>
          upsertRegion(w, { kind, ...data }),
        );
        const r = edit.result;
        const ver = r.previewVersion,
          bbox = r.sourceBBox;
        void image(token, ref.fileKey, ref.nodeId, bbox)
          .then(async (preview) => {
            if (!preview) return;
            await mutate((s) => {
              const w = s.workspaces.find((x) => x.id === wid),
                found = w?.regions.find((x) => x.id === r.id);
              if (found && found.previewVersion === ver)
                found.preview = preview;
            });
          })
          .catch(() => {});
        return json(res, 201, r, edit.revision);
      }
      let region = rest.match(/^regions\/([\w-]+)$/);
      if (region && method === "PATCH") {
        let b = await body(req);
        let edit = await editWorkspace(req, wid, (w) => {
          let r = findRegion(w, region![1]);
          if (b.name !== undefined) r.name = safeText(b.name, 200);
          if (b.description !== undefined)
            r.description = safeText(b.description, 2000);
          if (b.localBounds !== undefined) {
            if (!validBox(b.localBounds))
              throw new FigmaError("Invalid bounds");
            r.localBounds = b.localBounds;
          }
          return r;
        });
        return json(res, 200, edit.result, edit.revision);
      }
      if (region && method === "DELETE") {
        const edit = await editWorkspace(req, wid, (w) => deleteRegion(w, region![1]));
        return json(res, 200, { ok: true }, edit.revision);
      }
      if (rest === "move" && method === "POST") {
        const b = await body(req);
        if (
          typeof b.id !== "string" ||
          !(b.parentId === null || typeof b.parentId === "string") ||
          !Number.isInteger(b.index) ||
          b.index < 0
        )
          throw new FigmaError("Invalid move");
        const edit = await editWorkspace(req, wid, (w) => {
          try {
            moveUi(w, b.id, b.parentId, b.index);
          } catch (e) {
            throw new FigmaError(
              e instanceof Error ? e.message : "Invalid move",
            );
          }
        });
        return json(res, 200, { ok: true }, edit.revision);
      }
      if (rest === "relations" && method === "POST") {
        const b = await body(req);
        const edit = await editWorkspace(req, wid, (w) =>
          link(w, safeText(b.specId, 100), safeText(b.uiId, 100)),
        );
        return json(res, 200, edit.result, edit.revision);
      }
      let relation = rest.match(/^relations\/([\w-]+)$/);
      if (relation && method === "DELETE") {
        const edit = await editWorkspace(req, wid, (w) => {
          w.relations = w.relations.filter((r) => r.id !== relation![1]);
        });
        return json(res, 200, { ok: true }, edit.revision);
      }
      throw new FigmaError("Not found", 404);
    }
    if (method !== "GET") throw new FigmaError("Not found", 404);
    const file = path === "/" ? "index.html" : path.slice(1);
    if (file.includes("..") || file.includes("\\"))
      throw new FigmaError("Not found", 404);
    const data = await readFile(join(web, file));
    const type = file.endsWith(".html")
      ? "text/html; charset=utf-8"
      : file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "x-content-type-options": "nosniff",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch (e) {
    let err =
      e instanceof FigmaError
        ? e
        : new FigmaError(
            e instanceof Error && e.message.startsWith("Invalid")
              ? e.message
              : "Request failed",
            400,
          );
    json(res, err.status, { error: err.message, code: err.code });
  }
}
const server = http.createServer(handler);
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(
    e.code === "EADDRINUSE" ? `Port ${port} is already in use` : e.message,
  );
  dataLock.close();
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Figma Semantic Bridge: ${origin}`),
);

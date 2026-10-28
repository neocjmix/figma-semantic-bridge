import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { init, getToken, saveToken, readStore, writeStore } from "./storage.js";
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
function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
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
          store.workspaces.map(({ id, name }) => ({ id, name })),
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
        await mutate((s) => {
          workspace(s, wid);
          s.workspaces = s.workspaces.filter((w) => w.id !== wid);
        });
        return json(res, 200, { ok: true });
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
        const r = await mutate((s) =>
          upsertRegion(workspace(s, wid), { kind, ...data }),
        );
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
        return json(res, 201, r);
      }
      let region = rest.match(/^regions\/([\w-]+)$/);
      if (region && method === "PATCH") {
        let b = await body(req);
        let r = await mutate((s) => {
          let r = findRegion(workspace(s, wid), region![1]);
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
        return json(res, 200, r);
      }
      if (region && method === "DELETE") {
        await mutate((s) => deleteRegion(workspace(s, wid), region![1]));
        return json(res, 200, { ok: true });
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
        await mutate((s) => {
          const w = workspace(s, wid);
          try {
            moveUi(w, b.id, b.parentId, b.index);
          } catch (e) {
            throw new FigmaError(
              e instanceof Error ? e.message : "Invalid move",
            );
          }
        });
        return json(res, 200, { ok: true });
      }
      if (rest === "relations" && method === "POST") {
        const b = await body(req);
        return json(
          res,
          200,
          await mutate((s) =>
            link(
              workspace(s, wid),
              safeText(b.specId, 100),
              safeText(b.uiId, 100),
            ),
          ),
        );
      }
      let relation = rest.match(/^relations\/([\w-]+)$/);
      if (relation && method === "DELETE") {
        await mutate((s) => {
          const w = workspace(s, wid);
          w.relations = w.relations.filter((r) => r.id !== relation![1]);
        });
        return json(res, 200, { ok: true });
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
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Figma Semantic Bridge: ${origin}`),
);

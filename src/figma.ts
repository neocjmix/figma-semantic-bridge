import type { Box } from "./model.js";
import { validBox } from "./model.js";
const base = "https://api.figma.com/v1/";
export class FigmaError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "FIGMA_ERROR",
  ) {
    super(message);
  }
}
async function bounded(response: Response, limit: number) {
  let reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let chunks: Uint8Array[] = [],
    length = 0;
  while (true) {
    let { done, value } = await reader.read();
    if (done || !value) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new FigmaError(
        "Figma response is too large to locate this page safely",
        413,
        "TOO_LARGE",
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function call(path: string, token: string) {
  const r = await fetch(base + path, {
    headers: { "X-Figma-Token": token },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    if (r.status === 401)
      throw new FigmaError("Figma token is invalid or expired", 401, "TOKEN");
    if (r.status === 403)
      throw new FigmaError(
        "Figma denied access. Check the token and file permissions.",
        403,
        "ACCESS",
      );
    if (r.status === 404)
      throw new FigmaError(
        "Figma file was not found or is inaccessible",
        404,
        "NOT_FOUND",
      );
    if (r.status === 429)
      throw new FigmaError(
        "Figma rate limit reached. Try again later.",
        429,
        "RATE_LIMIT",
      );
    throw new FigmaError("Figma request failed", 502, "UPSTREAM");
  }
  return JSON.parse((await bounded(r, 2 * 1024 * 1024)).toString());
}
export async function validateToken(token: string) {
  if (!token.trim()) return false;
  const r = await fetch(
    base + "files/DefinitelyNonexistentFile/nodes?ids=0%3A0&depth=1",
    { headers: { "X-Figma-Token": token }, signal: AbortSignal.timeout(15000) },
  );
  if (r.status === 404) return true;
  if (r.status === 401 || r.status === 403) return false;
  if (r.status === 429)
    throw new FigmaError(
      "Figma rate limit reached. Try again later.",
      429,
      "RATE_LIMIT",
    );
  throw new FigmaError(
    "Figma could not validate the token right now.",
    502,
    "UPSTREAM",
  );
}
type Node = {
  id?: string;
  type?: string;
  name?: string;
  children?: Node[];
  absoluteBoundingBox?: Box;
  characters?: string;
};
function locate(n: Node, id: string, page: Node | null = null): Node | null {
  if (n.type === "CANVAS") page = n;
  if (n.id === id) return page;
  for (const c of n.children ?? []) {
    const match = locate(c, id, page);
    if (match) return match;
  }
  return null;
}
export async function lookup(
  token: string,
  ref: { fileKey: string; nodeId: string; url: string },
) {
  const key = encodeURIComponent(ref.fileKey),
    id = encodeURIComponent(ref.nodeId);
  const data = await call(`files/${key}/nodes?ids=${id}&depth=1`, token);
  const n: Node | undefined = data.nodes?.[ref.nodeId]?.document;
  if (!n || n.id !== ref.nodeId || !validBox(n.absoluteBoundingBox))
    throw new FigmaError(
      "The selected node is unavailable or has no usable bounds",
      404,
      "NODE",
    );
  let page: Node | null = null;
  for (let depth = 1; depth <= 32; depth++) {
    const doc = await call(`files/${key}?ids=${id}&depth=${depth}`, token);
    page = locate(doc.document, ref.nodeId);
    if (page) break;
  }
  if (!page?.id)
    throw new FigmaError(
      "Cannot determine the node’s page. Select another node or try again.",
      422,
      "PAGE",
    );
  return {
    figma: { ...ref, pageId: page.id },
    sourceName: n.name ?? "Untitled",
    sourceBBox: n.absoluteBoundingBox,
    textHint: n.type === "TEXT" ? n.characters?.slice(0, 500) : undefined,
  };
}
export async function image(
  token: string,
  key: string,
  nodeId: string,
  bbox: Box,
) {
  const id = encodeURIComponent(nodeId);
  const data = await call(
    `images/${encodeURIComponent(key)}?ids=${id}&format=png&use_absolute_bounds=true`,
    token,
  );
  const url = data.images?.[nodeId];
  if (typeof url !== "string") return;
  let next = new URL(url);
  let r: Response | undefined;
  for (let i = 0; i < 4; i++) {
    if (
      next.protocol !== "https:" ||
      !/(^|\.)(figma\.com|amazonaws\.com)$/.test(next.hostname)
    )
      return;
    r = await fetch(next, {
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return;
      next = new URL(loc, next);
      continue;
    }
    break;
  }
  if (!r?.ok) return;
  const b = await bounded(r, 16 * 1024 * 1024);
  if (
    b.length < 24 ||
    !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return;
  const width = b.readUInt32BE(16),
    height = b.readUInt32BE(20);
  if (
    !width ||
    !height ||
    Math.abs(width / height / (bbox.width / bbox.height) - 1) > 0.025
  )
    return;
  return `data:image/png;base64,${b.toString("base64")}`;
}

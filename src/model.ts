import { randomUUID } from "node:crypto";
export type Kind = "ui" | "spec";
export type Box = { x: number; y: number; width: number; height: number };
export type Region = {
  id: string;
  kind: Kind;
  figma: { fileKey: string; nodeId: string; pageId: string; url: string };
  name: string;
  description: string;
  sourceName: string;
  sourceBBox: Box;
  localBounds: Box;
  parentUiId: string | null;
  order: number;
  previewVersion: number;
  preview?: string;
  textHint?: string;
};
export type Relation = { id: string; specRegionId: string; uiRegionId: string };
export type Workspace = {
  id: string;
  name: string;
  revision?: number;
  regions: Region[];
  relations: Relation[];
};
export type Store = { workspaces: Workspace[] };
export const newWorkspace = (name: string): Workspace => ({
  id: randomUUID(),
  name: name.trim(),
  revision: 0,
  regions: [],
  relations: [],
});
export function validBox(b: unknown): b is Box {
  if (!b || typeof b !== "object") return false;
  const x = b as Box;
  return (
    [x.x, x.y, x.width, x.height].every(Number.isFinite) &&
    x.width > 0 &&
    x.height > 0
  );
}
export function figmaReference(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw Error("Invalid Figma URL");
  }
  if (u.protocol !== "https:" || u.hostname !== "www.figma.com")
    throw Error("Use a Figma Design node URL");
  const m = u.pathname.match(
    /^\/design\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?\/(?:[^/]+)\/?$/,
  );
  let nodeId = u.searchParams.get("node-id");
  if (!m || !nodeId || !/^(?:I?\d+[:-]\d+)(?:;\d+[:-]\d+)*$/.test(nodeId))
    throw Error("Select one supported Figma node");
  nodeId = nodeId.replaceAll("-", ":");
  return {
    fileKey: m[2] ?? m[1],
    nodeId,
    url: `https://www.figma.com/design/${m[2] ?? m[1]}/Node?node-id=${encodeURIComponent(nodeId)}`,
  };
}
export function findRegion(w: Workspace, id: string) {
  const r = w.regions.find((x) => x.id === id);
  if (!r) throw Error("Region not found");
  return r;
}
export function upsertRegion(
  w: Workspace,
  input: Pick<Region, "kind" | "figma" | "sourceName" | "sourceBBox"> & {
    textHint?: string;
  },
) {
  let r = w.regions.find(
    (x) =>
      x.kind === input.kind &&
      x.figma.fileKey === input.figma.fileKey &&
      x.figma.nodeId === input.figma.nodeId,
  );
  if (r) {
    r.figma = input.figma;
    r.sourceName = input.sourceName;
    r.sourceBBox = input.sourceBBox;
    r.textHint = input.textHint;
    r.previewVersion++;
    delete r.preview;
    return r;
  }
  r = {
    id: randomUUID(),
    ...input,
    name: input.sourceName,
    description: "",
    localBounds: { ...input.sourceBBox },
    parentUiId: null,
    order: w.regions.filter((x) => x.kind === input.kind).length,
    previewVersion: 1,
  };
  w.regions.push(r);
  return r;
}
export function moveUi(
  w: Workspace,
  id: string,
  parentId: string | null,
  index: number,
) {
  let r = findRegion(w, id);
  if (r.kind !== "ui") throw Error("Only UI regions can be nested");
  if (parentId) {
    let p = findRegion(w, parentId);
    if (p.kind !== "ui") throw Error("UI can only be nested under UI");
    let seen = new Set<string>();
    while (p) {
      if (p.id === id || seen.has(p.id))
        throw Error("This move would create a cycle");
      seen.add(p.id);
      if (!p.parentUiId) break;
      p = findRegion(w, p.parentUiId);
    }
  }
  let siblings = w.regions
    .filter((x) => x.kind === "ui" && x.parentUiId === parentId && x.id !== id)
    .sort((a, b) => a.order - b.order);
  siblings.splice(
    Math.max(0, Math.min(siblings.length, Math.floor(index))),
    0,
    r,
  );
  r.parentUiId = parentId;
  siblings.forEach((x, i) => (x.order = i));
}
export function link(w: Workspace, specId: string, uiId: string) {
  if (
    findRegion(w, specId).kind !== "spec" ||
    findRegion(w, uiId).kind !== "ui"
  )
    throw Error("A Spec can only link to a UI");
  let rel = w.relations.find(
    (x) => x.specRegionId === specId && x.uiRegionId === uiId,
  );
  if (!rel) {
    rel = { id: randomUUID(), specRegionId: specId, uiRegionId: uiId };
    w.relations.push(rel);
  }
  return rel;
}
export function deleteRegion(w: Workspace, id: string) {
  let r = findRegion(w, id);
  w.regions = w.regions.filter((x) => x.id !== id);
  w.relations = w.relations.filter(
    (x) => x.specRegionId !== id && x.uiRegionId !== id,
  );
  if (r.kind === "ui")
    for (const child of w.regions)
      if (child.parentUiId === id) child.parentUiId = null;
}
export function exportWorkspace(w: Workspace) {
  let ui = w.regions.filter((x) => x.kind === "ui");
  let semantic = (r: Region) => ({
    id: r.id,
    kind: r.kind,
    figma: r.figma,
    name: r.name,
    description: r.description,
  });
  function children(parent: string | null): unknown[] {
    return ui
      .filter((r) => r.parentUiId === parent)
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ ...semantic(r), children: children(r.id) }));
  }
  return {
    workspace: { id: w.id, name: w.name },
    ui: children(null),
    specs: w.regions
      .filter((x) => x.kind === "spec")
      .sort((a, b) => a.order - b.order)
      .map(semantic),
    relations: w.relations.map((x) => ({ ...x })),
  };
}

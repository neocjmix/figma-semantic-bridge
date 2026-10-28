import test from "node:test";
import assert from "node:assert/strict";
import {
  newWorkspace,
  upsertRegion,
  moveUi,
  link,
  deleteRegion,
  exportWorkspace,
  figmaReference,
  validBox,
} from "../src/model.js";
const box = { x: -3.25, y: 1.5, width: 100, height: 50 };
const mk = (
  w: ReturnType<typeof newWorkspace>,
  kind: "ui" | "spec",
  id: string,
  file = "abc",
) =>
  upsertRegion(w, {
    kind,
    figma: {
      fileKey: file,
      nodeId: id,
      pageId: "0:1",
      url: `https://www.figma.com/design/${file}/?node-id=${id}`,
    },
    sourceName: id,
    sourceBBox: box,
    textHint: "private text",
  });
test("identity and resend preserve user metadata and relationships", () => {
  let w = newWorkspace("x"),
    a = mk(w, "ui", "1:2"),
    b = mk(w, "ui", "1:3"),
    s = mk(w, "spec", "1:2");
  a.name = "Human";
  a.localBounds.x = 42;
  moveUi(w, a.id, b.id, 0);
  link(w, s.id, a.id);
  let again = mk(w, "ui", "1:2");
  assert.equal(again.id, a.id);
  assert.equal(a.name, "Human");
  assert.equal(a.localBounds.x, 42);
  assert.equal(a.parentUiId, b.id);
  assert.equal(w.relations.length, 1);
  assert.notEqual(mk(w, "ui", "1:2", "other").id, a.id);
});
test("ordered acyclic tree and many to many links", () => {
  let w = newWorkspace("x"),
    a = mk(w, "ui", "1:1"),
    b = mk(w, "ui", "1:2"),
    c = mk(w, "ui", "1:3"),
    s = mk(w, "spec", "1:4");
  moveUi(w, a.id, b.id, 0);
  moveUi(w, b.id, c.id, 0);
  assert.throws(() => moveUi(w, c.id, a.id, 0));
  assert.throws(() => moveUi(w, a.id, s.id, 0));
  link(w, s.id, a.id);
  link(w, s.id, a.id);
  link(w, s.id, c.id);
  assert.equal(w.relations.length, 2);
  deleteRegion(w, s.id);
  assert.equal(w.relations.length, 0);
  assert.equal(a.parentUiId, b.id);
});
test("export omits editing aids", () => {
  let w = newWorkspace("x");
  let a = mk(w, "ui", "1:1");
  a.preview = "data:image/png;base64,abc";
  let out = JSON.stringify(exportWorkspace(w));
  for (let word of [
    "sourceBBox",
    "localBounds",
    "preview",
    "textHint",
    "private text",
  ])
    assert.equal(out.includes(word), false);
});
test("strict Figma references and fractional bounds", () => {
  assert.equal(
    figmaReference("https://www.figma.com/design/abc/name?node-id=1-2").nodeId,
    "1:2",
  );
  assert.throws(() =>
    figmaReference("https://evil.example/design/abc/name?node-id=1-2"),
  );
  assert.throws(() => figmaReference("https://www.figma.com/design/abc/name"));
  assert.ok(validBox(box));
  assert.equal(validBox({ ...box, width: 0 }), false);
});

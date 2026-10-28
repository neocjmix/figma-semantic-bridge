import test from "node:test";
import assert from "node:assert/strict";
import { observePreview } from "../web/preview.js";

test("a delayed preview is shown after the former eight-poll limit", async () => {
  let reads = 0;
  let shown = "";
  await observePreview(
    "region", 1,
    async () => [{ id: "region", previewVersion: 1, preview: ++reads === 11 ? "image" : undefined }],
    (preview) => { shown = preview; },
    async () => {},
  );
  assert.equal(reads, 11);
  assert.equal(shown, "image");
});

test("an old or removed region cannot publish a stale preview", async () => {
  for (const regions of [
    [{ id: "region", previewVersion: 2, preview: "new" }],
    [],
  ]) {
    let published = false;
    await observePreview("region", 1, async () => regions, () => { published = true; }, async () => {});
    assert.equal(published, false);
  }
});

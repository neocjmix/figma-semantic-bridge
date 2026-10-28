import test from "node:test";
import assert from "node:assert/strict";
import { lookup, image, validateToken, FigmaError } from "../src/figma.js";
const token = "test-only";
const ref = {
    fileKey: "file1",
    nodeId: "2:7",
    url: "https://www.figma.com/design/file1/Node?node-id=2%3A7",
  },
  bbox = { x: -2.5, y: 1.25, width: 100, height: 50 };
test("token probe handles authentication and upstream errors without unrelated scopes", async () => {
  const old = globalThis.fetch;
  let status = 404, calls = 0;
  globalThis.fetch = async (input, options) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.figma.com");
    assert.match(url.pathname, /\/nodes$/);
    assert.equal(new Headers(options?.headers).get("x-figma-token"), token);
    return new Response(null, { status });
  };
  try {
    assert.equal(await validateToken(""), false);
    assert.equal(calls, 0);
    assert.equal(await validateToken(token), true);
    for (const denied of [401, 403]) {
      status = denied;
      assert.equal(await validateToken(token), false);
    }
    status = 429;
    await assert.rejects(validateToken(token), (e) => e instanceof FigmaError && e.code === "RATE_LIMIT");
    status = 500;
    await assert.rejects(validateToken(token), (e) => e instanceof FigmaError && e.code === "UPSTREAM");
  } finally {
    globalThis.fetch = old;
  }
});
test("bounded node lookup finds page without trusting URL or scanning the selected subtree", async () => {
  let old = globalThis.fetch,
    requests: string[] = [];
  globalThis.fetch = async (input) => {
    let u = new URL(String(input));
    requests.push(u.toString());
    assert.equal(u.hostname, "api.figma.com");
    if (u.pathname.endsWith("/nodes"))
      return Response.json({
        nodes: {
          "2:7": {
            document: {
              id: "2:7",
              type: "FRAME",
              name: "Card",
              absoluteBoundingBox: bbox,
            },
          },
        },
      });
    const d = Number(u.searchParams.get("depth"));
    return Response.json({
      document: {
        id: "0:0",
        type: "DOCUMENT",
        children: [
          {
            id: "0:1",
            type: "CANVAS",
            children:
              d >= 3
                ? [
                    {
                      id: "2:1",
                      children: d >= 3 ? [{ id: "2:7", children: [] }] : [],
                    },
                  ]
                : [],
          },
        ],
      },
    });
  };
  try {
    let r = await lookup(token, ref);
    assert.equal(r.figma.pageId, "0:1");
    assert.deepEqual(r.sourceBBox, bbox);
    assert.deepEqual(
      requests.map((x) => new URL(x).searchParams.get("depth")),
      ["1", "1", "2", "3"],
    );
  } finally {
    globalThis.fetch = old;
  }
});
test("a 200 response with missing node cannot create a region", async () => {
  let old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ nodes: { "2:7": null } });
  try {
    await assert.rejects(
      lookup(token, ref),
      (e) => e instanceof FigmaError && e.code === "NODE",
    );
  } finally {
    globalThis.fetch = old;
  }
});
test("images with incompatible aspect ratios remain placeholders", async () => {
  let old = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    if (u.hostname === "api.figma.com")
      return Response.json({
        images: { "2:7": "https://images.figma.com/test.png" },
      });
    let p = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(p);
    p.writeUInt32BE(100, 16);
    p.writeUInt32BE(100, 20);
    return new Response(p);
  };
  try {
    assert.equal(await image(token, "file1", "2:7", bbox), undefined);
  } finally {
    globalThis.fetch = old;
  }
});

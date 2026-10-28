const original = globalThis.fetch;
let imageCount = 0;
globalThis.fetch = async (input, options = {}) => {
  const u = new URL(String(input));
  if (u.hostname === "images.figma.com" && u.pathname.startsWith("/race/")) {
    const version = Number(u.pathname.split("/").pop());
    if (version === 1) await new Promise((resolve) => setTimeout(resolve, 500));
    const png = Buffer.alloc(25);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(100, 16);
    png.writeUInt32BE(50, 20);
    png[24] = version;
    return new Response(png);
  }
  if (u.hostname !== "api.figma.com") return original(input, options);
  const token = new Headers(options.headers).get("x-figma-token");
  if (token !== "valid-test-token")
    return Response.json({ err: "denied" }, { status: 403 });
  if (u.pathname.includes("DefinitelyNonexistentFile"))
    return Response.json({ err: "not found" }, { status: 404 });
  const id = u.searchParams.get("ids");
  const file = u.pathname.split("/")[3];
  if (file === "missing")
    return Response.json({ err: "not found" }, { status: 404 });
  if (u.pathname.includes("/images/"))
    return Response.json({
      images: {
        [id]:
          id === "7:7" ? `https://images.figma.com/race/${++imageCount}` : null,
      },
    });
  if (u.pathname.endsWith("/nodes"))
    return Response.json({
      nodes: {
        [id]:
          id === "99:99"
            ? null
            : {
                document: {
                  id,
                  name: "Source " + id,
                  type: "FRAME",
                  absoluteBoundingBox: {
                    x: -2.5,
                    y: 4,
                    width: 100,
                    height: 50,
                  },
                },
              },
      },
    });
  return Response.json({
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: file === "file2" ? "0:2" : "0:1",
          type: "CANVAS",
          children: [{ id, type: "FRAME", children: [] }],
        },
      ],
    },
  });
};

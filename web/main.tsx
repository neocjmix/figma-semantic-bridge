import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Box, Region, Workspace } from "../src/model.js";
import "./styles.css";
const base = "/api";
type Brief = { id: string; name: string };
type Notice = { url: string; nonce: string };
async function api(path: string, method = "GET", data?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: data === undefined ? {} : { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const v = await r.json();
  if (!r.ok) {
    const e = new Error(v.error ?? "Request failed") as Error & {
      code?: string;
    };
    e.code = v.code;
    throw e;
  }
  return v;
}
function App() {
  const [gate, setGate] = useState<
      "loading" | "token" | "workspace" | "editor"
    >("loading"),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [spaces, setSpaces] = useState<Brief[]>([]),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [name, setName] = useState(""),
    [tab, setTab] = useState<"canvas" | "regions">("canvas"),
    [selected, setSelected] = useState<string | null>(null),
    [partition, setPartition] = useState(""),
    [notice, setNotice] = useState<Notice | null>(null),
    [busy, setBusy] = useState(false),
    [reenter, setReenter] = useState(false);
  const stateRef = useRef({ gate, workspace });
  stateRef.current = { gate, workspace };
  const lastNonce = useRef("");
  const nameRef = useRef<HTMLInputElement>(null);
  const bookmarkRef = useRef<HTMLAnchorElement>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const active = workspace?.regions.find((r) => r.id === selected);
  const prefix = workspace ? `/workspaces/${workspace.id}` : "";
  const showError = useCallback((e: unknown) => {
    const x = e as Error & { code?: string };
    setError(x.message || "Something went wrong");
    if (x.code === "TOKEN" && stateRef.current.gate === "editor")
      setReenter(true);
  }, []);
  const loadSpaces = useCallback(async () => {
    try {
      setSpaces(await api("/workspaces"));
      setGate("workspace");
    } catch (e) {
      showError(e);
    }
  }, [showError]);
  const open = useCallback(
    async (id: string) => {
      try {
        const w: Workspace = await api(`/workspaces/${id}`);
        setWorkspace(w);
        localStorage.setItem("fsb-workspace", id);
        setSelected(null);
        setPartition("");
        setGate("editor");
      } catch (e) {
        showError(e);
        await loadSpaces();
      }
    },
    [showError, loadSpaces],
  );
  useEffect(() => {
    window.name = "figma-semantic-bridge";
    void (async () => {
      try {
        let s = await api("/status");
        if (!s.authenticated) {
          setGate("token");
          return;
        }
        let id = localStorage.getItem("fsb-workspace");
        if (id) await open(id);
        else await loadSpaces();
      } catch (e) {
        showError(e);
        setGate("token");
      }
    })();
  }, [open, loadSpaces, showError]);
  useEffect(() => {
    function receive() {
      if (stateRef.current.gate === "loading") return;
      if (!location.hash) return;
      let p = new URLSearchParams(location.hash.slice(1)),
        url = p.get("url"),
        nonce = p.get("nonce");
      history.replaceState(null, "", location.pathname);
      if (!url || !nonce) {
        setError("The Figma selection link is invalid.");
        return;
      }
      if (nonce === lastNonce.current) return;
      lastNonce.current = nonce;
      if (stateRef.current.gate !== "editor" || !stateRef.current.workspace) {
        setError(
          "Choose a workspace and connect Figma before sending a selection.",
        );
        return;
      }
      setNotice({ url, nonce });
    }
    addEventListener("hashchange", receive);
    if (gate !== "loading") receive();
    return () => removeEventListener("hashchange", receive);
  }, [gate]);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/token", "POST", { token });
      setToken("");
      setReenter(false);
      if (workspace) {
        setGate("editor");
      } else await loadSpaces();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      let w: Workspace = await api("/workspaces", "POST", { name });
      setName("");
      await open(w.id);
    } catch (e) {
      showError(e);
    }
  }
  async function importNode(kind: "ui" | "spec") {
    if (!notice || !workspace) return;
    const w = workspace.id,
      url = notice.url;
    setNotice(null);
    setBusy(true);
    setError("");
    try {
      let r: Region = await api(`/workspaces/${w}/import`, "POST", {
        url,
        kind,
      });
      if (stateRef.current.workspace?.id === w) {
        const fresh: Workspace = await api(`/workspaces/${w}`);
        if (stateRef.current.workspace?.id === w) {
          setWorkspace(fresh);
          setPartition(r.figma.fileKey + "|" + r.figma.pageId);
          setSelected(r.id);
          setTimeout(() => nameRef.current?.focus(), 0);
        }
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        let fresh: Workspace = await api(`/workspaces/${w}`);
        let p = fresh.regions.find((x) => x.id === r.id)?.preview;
        if (p && stateRef.current.workspace?.id === w) {
          setWorkspace((old) =>
            old?.id === w
              ? {
                  ...old,
                  regions: old.regions.map((x) =>
                    x.id === r.id ? { ...x, preview: p } : x,
                  ),
                }
              : old,
          );
          break;
        }
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!workspace) return;
    const id = workspace.id;
    await saveQueue.current;
    const fresh: Workspace = await api(prefix);
    setWorkspace((current) => (current?.id === id ? fresh : current));
  }
  async function change(r: Region, patch: Partial<Region>) {
    if (!workspace) return;
    setWorkspace((w) =>
      w?.id === workspace.id
        ? {
            ...w,
            regions: w.regions.map((x) =>
              x.id === r.id ? { ...x, ...patch } : x,
            ),
          }
        : w,
    );
    const request = saveQueue.current.then(() =>
      api(prefix + "/regions/" + r.id, "PATCH", patch),
    );
    saveQueue.current = request.catch((e) => {
      showError(e);
    });
    await saveQueue.current;
  }
  async function remove(r: Region) {
    if (!confirm(`Delete “${r.name || "Untitled"}”?`)) return;
    try {
      await api(prefix + "/regions/" + r.id, "DELETE");
      setSelected(null);
      await refresh();
    } catch (e) {
      showError(e);
    }
  }
  async function move(id: string, parentId: string | null, index: number) {
    try {
      await api(prefix + "/move", "POST", { id, parentId, index });
      await refresh();
    } catch (e) {
      showError(e);
    }
  }
  async function addLink(specId: string, uiId: string) {
    try {
      await api(prefix + "/relations", "POST", { specId, uiId });
      await refresh();
    } catch (e) {
      showError(e);
    }
  }
  async function unlink(id: string) {
    try {
      await api(prefix + "/relations/" + id, "DELETE");
      await refresh();
    } catch (e) {
      showError(e);
    }
  }
  const bookmark = `javascript:(()=>{const u=location.href,n=Date.now().toString(36)+Math.random().toString(36).slice(2);window.open('${location.origin}/#'+new URLSearchParams({url:u,nonce:n}),'figma-semantic-bridge');})();`;
  useEffect(() => {
    if (bookmarkRef.current) bookmarkRef.current.setAttribute("href", bookmark);
  }, [gate, workspace?.id, bookmark, reenter]);
  return (
    <>
      <header>
        <strong>Semantic Bridge</strong>
        {gate === "editor" && workspace && (
          <>
            <button
              className="quiet"
              onClick={() => {
                setWorkspace(null);
                localStorage.removeItem("fsb-workspace");
                void loadSpaces();
              }}
            >
              ← Workspaces
            </button>
            <span className="workspace-title">{workspace.name}</span>
            <a
              className="export"
              href={base + prefix + "/export"}
              download={`${workspace.name}.json`}
            >
              Export JSON
            </a>
          </>
        )}
      </header>
      {error && (
        <div role="alert" className="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {(gate === "token" || reenter) && (
        <div className={reenter ? "overlay" : ""}>
          <form className="card token" onSubmit={connect}>
            <h1>Connect Figma</h1>
            <p>Enter a personal access token with file content read access.</p>
            <label>
              Figma token
              <input
                autoFocus
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <div className="actions">
              <button disabled={busy || !token}>Connect</button>
              {reenter && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => setReenter(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      )}
      {gate === "workspace" && !reenter && (
        <main className="landing">
          <h1>Your workspaces</h1>
          <p>Organize the meanings you add to your Figma selections.</p>
          <form className="create" onSubmit={create}>
            <label>
              New workspace
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Workspace name"
              />
            </label>
            <button disabled={!name.trim()}>Create</button>
          </form>
          <div className="space-list">
            {spaces.map((s) => (
              <div key={s.id}>
                <button className="space" onClick={() => void open(s.id)}>
                  {s.name} <span>Open →</span>
                </button>
                <button
                  className="quiet"
                  onClick={async () => {
                    if (confirm(`Delete workspace “${s.name}”?`)) {
                      try {
                        await api(`/workspaces/${s.id}`, "DELETE");
                        await loadSpaces();
                      } catch (e) {
                        showError(e);
                      }
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </main>
      )}
      {gate === "editor" && workspace && !reenter && (
        <>
          <nav className="tabs">
            <button
              aria-selected={tab === "canvas"}
              onClick={() => setTab("canvas")}
            >
              Canvas
            </button>
            <button
              aria-selected={tab === "regions"}
              onClick={() => setTab("regions")}
            >
              Regions
            </button>
            <span className="spacer" />
            <a
              ref={bookmarkRef}
              href="#"
              onClick={(e) => e.preventDefault()}
              title="Drag to your bookmarks bar"
            >
              Send from Figma ↗
            </a>
          </nav>
          <div className="instruction">
            Select a layer in Figma web, then use the{" "}
            <strong>Send from Figma</strong> bookmark. Drag the link above to
            your bookmarks bar once.
          </div>
          <div style={{ display: tab === "canvas" ? "contents" : "none" }}>
            <Canvas
              regions={workspace.regions}
              partition={partition}
              setPartition={(p) => {
                setPartition(p);
                if (
                  active &&
                  active.figma.fileKey + "|" + active.figma.pageId !== p
                )
                  setSelected(null);
              }}
              selected={selected}
              select={(id) => {
                setSelected(id);
                setTimeout(() => nameRef.current?.focus(), 0);
              }}
              onBounds={(r, b) => void change(r, { localBounds: b })}
            />
          </div>
          <div style={{ display: tab === "regions" ? "contents" : "none" }}>
            <Regions
              w={workspace}
              selected={selected}
              select={(id) => {
                setSelected(id);
                setTimeout(() => nameRef.current?.focus(), 0);
              }}
              move={move}
              addLink={addLink}
              unlink={unlink}
            />
          </div>
          {active && (
            <aside className="editbar">
              <label>
                Name
                <input
                  ref={nameRef}
                  value={active.name}
                  onChange={(e) =>
                    void change(active, { name: e.target.value })
                  }
                  placeholder="Name this region"
                />
              </label>
              <label>
                Description
                <input
                  value={active.description}
                  onChange={(e) =>
                    void change(active, { description: e.target.value })
                  }
                  placeholder="Optional"
                />
              </label>
              <button
                className="quiet danger"
                onClick={() => void remove(active)}
              >
                Delete
              </button>
            </aside>
          )}
        </>
      )}
      {notice && (
        <div className="overlay">
          <section
            className="card choice"
            role="dialog"
            aria-modal="true"
            aria-label="Choose region type"
          >
            <h2>What are you adding?</h2>
            <p>Choose how this Figma selection should be used.</p>
            <div className="choice-buttons">
              <button onClick={() => void importNode("ui")}>
                UI region<span>A part of the interface</span>
              </button>
              <button onClick={() => void importNode("spec")}>
                Spec region<span>Guidance about the interface</span>
              </button>
            </div>
            <button className="quiet" onClick={() => setNotice(null)}>
              Cancel
            </button>
          </section>
        </div>
      )}
    </>
  );
}
type CanvasProps = {
  regions: Region[];
  partition: string;
  setPartition: (p: string) => void;
  selected: string | null;
  select: (id: string) => void;
  onBounds: (r: Region, b: Box) => void;
};
function Canvas({
  regions,
  partition,
  setPartition,
  selected,
  select,
  onBounds,
}: CanvasProps) {
  const viewport = useRef<HTMLDivElement>(null),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 80, y: 80 });
  const gesture = useRef<{
    type: "pan" | "move" | "resize";
    x: number;
    y: number;
    pan?: { x: number; y: number };
    region?: Region;
    box?: Box;
  } | null>(null);
  const partitions = [
    ...new Set(regions.map((r) => r.figma.fileKey + "|" + r.figma.pageId)),
  ];
  const activePartition = partitions.includes(partition)
    ? partition
    : (partitions[0] ?? "");
  const visible = regions.filter(
    (r) => r.figma.fileKey + "|" + r.figma.pageId === activePartition,
  );
  function fit() {
    if (!viewport.current || !visible.length) return;
    let minX = Math.min(...visible.map((r) => r.localBounds.x)),
      minY = Math.min(...visible.map((r) => r.localBounds.y)),
      maxX = Math.max(
        ...visible.map((r) => r.localBounds.x + r.localBounds.width),
      ),
      maxY = Math.max(
        ...visible.map((r) => r.localBounds.y + r.localBounds.height),
      );
    const rect = viewport.current.getBoundingClientRect();
    let z = Math.max(
      0.03,
      Math.min(
        2,
        (rect.width - 100) / (maxX - minX),
        (rect.height - 100) / (maxY - minY),
      ),
    );
    setZoom(z);
    setPan({
      x: (rect.width - (maxX - minX) * z) / 2 - minX * z,
      y: (rect.height - (maxY - minY) * z) / 2 - minY * z,
    });
  }
  useEffect(() => {
    fit();
  }, [activePartition, visible.length]);
  return (
    <div className="canvas-layout">
      <aside className="partition">
        <h2>Pages</h2>
        {!partitions.length && <p>No regions yet.</p>}
        {partitions.map((p) => {
          let [file, page] = p.split("|");
          return (
            <button
              key={p}
              className={p === activePartition ? "current" : ""}
              onClick={() => setPartition(p)}
            >
              <strong>{file}</strong>
              <span>Page {page}</span>
            </button>
          );
        })}
      </aside>
      <div className="canvas-wrap">
        <div className="canvas-tools">
          <button onClick={fit}>Fit</button>
          <button
            onClick={() => setZoom((z) => Math.max(0.03, z / 1.2))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(4, z * 1.2))}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
        <div
          className="canvas"
          ref={viewport}
          onWheel={(e) => {
            e.preventDefault();
            setZoom((z) =>
              Math.max(0.03, Math.min(4, z * (e.deltaY > 0 ? 0.9 : 1.1))),
            );
          }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            gesture.current = { type: "pan", x: e.clientX, y: e.clientY, pan };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const g = gesture.current;
            if (!g) return;
            const dx = e.clientX - g.x,
              dy = e.clientY - g.y;
            if (g.type === "pan" && g.pan)
              setPan({ x: g.pan.x + dx, y: g.pan.y + dy });
            else if (g.region && g.box) {
              const b =
                g.type === "move"
                  ? { ...g.box, x: g.box.x + dx / zoom, y: g.box.y + dy / zoom }
                  : {
                      ...g.box,
                      width: Math.max(1, g.box.width + dx / zoom),
                      height: Math.max(1, g.box.height + dy / zoom),
                    };
              const el = viewport.current?.querySelector<HTMLElement>(
                `[data-region="${g.region.id}"]`,
              );
              if (el) {
                el.style.left = b.x + "px";
                el.style.top = b.y + "px";
                el.style.width = b.width + "px";
                el.style.height = b.height + "px";
              }
            }
          }}
          onPointerUp={(e) => {
            const g = gesture.current;
            gesture.current = null;
            if (g?.region && g.box) {
              const dx = (e.clientX - g.x) / zoom,
                dy = (e.clientY - g.y) / zoom;
              const b =
                g.type === "move"
                  ? { ...g.box, x: g.box.x + dx, y: g.box.y + dy }
                  : {
                      ...g.box,
                      width: Math.max(1, g.box.width + dx),
                      height: Math.max(1, g.box.height + dy),
                    };
              onBounds(g.region, b);
            }
          }}
        >
          {!visible.length && (
            <div className="canvas-empty">
              <h2>Start in Figma</h2>
              <p>
                Select a layer in Figma web and use your bookmark to add it
                here.
              </p>
            </div>
          )}
          <div
            className="world"
            style={{
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
          >
            {visible.map((r) => (
              <div
                key={r.id}
                data-region={r.id}
                className={`region ${r.kind} ${r.id === selected ? "selected" : ""}`}
                style={{
                  left: r.localBounds.x,
                  top: r.localBounds.y,
                  width: r.localBounds.width,
                  height: r.localBounds.height,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  select(r.id);
                  gesture.current = {
                    type: "move",
                    x: e.clientX,
                    y: e.clientY,
                    region: r,
                    box: { ...r.localBounds },
                  };
                  viewport.current?.setPointerCapture(e.pointerId);
                }}
              >
                {r.preview ? (
                  <img src={r.preview} alt="" draggable={false} />
                ) : (
                  <div className="placeholder">
                    {r.kind === "ui" ? "UI" : "Spec"}
                  </div>
                )}
                <span className="region-label">{r.name || "Untitled"}</span>
                {r.id === selected && (
                  <span
                    className="resize"
                    role="button"
                    aria-label="Resize"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      gesture.current = {
                        type: "resize",
                        x: e.clientX,
                        y: e.clientY,
                        region: r,
                        box: { ...r.localBounds },
                      };
                      viewport.current?.setPointerCapture(e.pointerId);
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
type RegionProps = {
  w: Workspace;
  selected: string | null;
  select: (id: string) => void;
  move: (id: string, parentId: string | null, index: number) => Promise<void>;
  addLink: (s: string, u: string) => Promise<void>;
  unlink: (id: string) => Promise<void>;
};
function Regions({ w, selected, select, move, addLink, unlink }: RegionProps) {
  const ui = w.regions.filter((x) => x.kind === "ui"),
    specs = w.regions.filter((x) => x.kind === "spec");
  function children(id: string | null) {
    return ui
      .filter((r) => r.parentUiId === id)
      .sort((a, b) => a.order - b.order);
  }
  function drop(e: React.DragEvent, id: string | null) {
    e.preventDefault();
    e.stopPropagation();
    let s = e.dataTransfer.getData("text/plain");
    if (s.startsWith("spec:") && id) void addLink(s.slice(5), id);
    if (s.startsWith("ui:")) void move(s.slice(3), id, children(id).length);
  }
  function tree(parent: string | null): React.ReactNode {
    return children(parent).map((r, index) => {
      const siblings = children(parent),
        edges = w.relations.filter((x) => x.uiRegionId === r.id);
      return (
        <li key={r.id}>
          <div
            className={`tree-row ${selected === r.id ? "chosen" : ""}`}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData("text/plain", "ui:" + r.id);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, r.id)}
          >
            <button className="region-name" onClick={() => select(r.id)}>
              {r.preview ? (
                <img src={r.preview} alt="" />
              ) : (
                <span className="thumb">UI</span>
              )}
              <span>{r.name || "Untitled"}</span>
            </button>
            <div className="row-actions">
              <button
                title="Move up"
                aria-label={`Move ${r.name} up`}
                disabled={index === 0}
                onClick={() => void move(r.id, parent, index - 1)}
              >
                ↑
              </button>
              <button
                title="Move down"
                aria-label={`Move ${r.name} down`}
                disabled={index === siblings.length - 1}
                onClick={() => void move(r.id, parent, index + 1)}
              >
                ↓
              </button>
              <label className="sr-only" htmlFor={"parent-" + r.id}>
                Parent for {r.name}
              </label>
              <select
                id={"parent-" + r.id}
                aria-label={`Parent for ${r.name}`}
                value={parent ?? ""}
                onChange={(e) =>
                  void move(
                    r.id,
                    e.target.value || null,
                    children(e.target.value || null).length,
                  )
                }
              >
                <option value="">Root</option>
                {ui
                  .filter((x) => x.id !== r.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name || "Untitled"}
                    </option>
                  ))}
              </select>
              <label className="sr-only" htmlFor={"link-" + r.id}>
                Link spec to {r.name}
              </label>
              <select
                id={"link-" + r.id}
                aria-label={`Link spec to ${r.name}`}
                value=""
                onChange={(e) =>
                  e.target.value && void addLink(e.target.value, r.id)
                }
              >
                <option value="">+ Spec</option>
                {specs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || "Untitled"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {edges.map((e) => {
            let s = specs.find((x) => x.id === e.specRegionId);
            return (
              s && (
                <div key={e.id} className="ghost">
                  <span>↗ {s.name || "Untitled"}</span>
                  <button
                    onClick={() => void unlink(e.id)}
                    aria-label={`Unlink ${s.name} from ${r.name}`}
                  >
                    Unlink
                  </button>
                </div>
              )
            );
          })}
          <ul>{tree(r.id)}</ul>
        </li>
      );
    });
  }
  return (
    <div className="region-columns">
      <section>
        <div className="column-heading">
          <div>
            <h2>UI hierarchy</h2>
            <p>Arrange UI regions and link specs.</p>
          </div>
        </div>
        <div
          className="list-scroll"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => drop(e, null)}
        >
          <ul className="tree">{tree(null)}</ul>
          {!ui.length && (
            <p className="empty">Add a UI region from Figma to get started.</p>
          )}
          <div className="root-drop">
            Drop a UI region here to move it to the root
          </div>
        </div>
      </section>
      <section>
        <div className="column-heading">
          <div>
            <h2>Specs</h2>
            <p>Drag a spec onto any UI region.</p>
          </div>
        </div>
        <div className="list-scroll">
          {specs.map((s) => (
            <div
              key={s.id}
              className={`spec-row ${selected === s.id ? "chosen" : ""}`}
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData("text/plain", "spec:" + s.id)
              }
            >
              <button className="region-name" onClick={() => select(s.id)}>
                <span className="thumb spec-thumb">S</span>
                <span>{s.name || s.textHint || "Untitled"}</span>
              </button>
            </div>
          ))}
          {!specs.length && (
            <p className="empty">Add a Spec region from Figma.</p>
          )}
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

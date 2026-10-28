import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Store } from "./model.js";
export const directory =
  process.env.FSB_V05_DATA_DIR ?? join(homedir(), ".figma-semantic-bridge-v05");
export async function init() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
}
async function atomic(path: string, value: string) {
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, value, { mode: 0o600, flag: "wx" });
  await rename(temp, path);
}
export async function getToken() {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;
  try {
    return (await readFile(join(directory, "token"), "utf8")).trim();
  } catch {
    return "";
  }
}
export async function saveToken(t: string) {
  await atomic(join(directory, "token"), t);
  await chmod(join(directory, "token"), 0o600);
}
export async function readStore(): Promise<Store> {
  try {
    const v = JSON.parse(
      await readFile(join(directory, "workspaces.json"), "utf8"),
    );
    if (!v || !Array.isArray(v.workspaces))
      throw Error("Invalid workspace file");
    return v;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { workspaces: [] };
    throw e;
  }
}
export async function writeStore(s: Store) {
  await atomic(join(directory, "workspaces.json"), JSON.stringify(s));
}

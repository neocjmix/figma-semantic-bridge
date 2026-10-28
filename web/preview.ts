import type { Region } from "../src/model.js";

type Preview = Pick<Region, "id" | "previewVersion" | "preview">;

// Observe the one in-flight image request; do not retry it on failure.
export async function observePreview(
  id: string,
  version: number,
  read: () => Promise<Preview[]>,
  publish: (preview: string) => void,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 1200)),
) {
  // The image API and up to four download hops each have a 30s timeout.
  for (let attempt = 0; attempt < 132; attempt++) {
    await wait();
    let regions: Preview[];
    try {
      regions = await read();
    } catch {
      return;
    }
    const region = regions.find((x) => x.id === id);
    if (!region || region.previewVersion !== version) return;
    if (region.preview) {
      publish(region.preview);
      return;
    }
  }
}

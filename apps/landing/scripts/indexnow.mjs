import { readFile, writeFile } from "node:fs/promises";
import {
  changedUrls,
  INDEXNOW_KEY,
  MANIFEST_PATH,
  ORIGIN,
  submissionUrls,
  validateManifest,
} from "./search-manifest.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(url, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status !== 429 && response.status < 500) return response;
      if (attempt === 2) return response;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await sleep(3000 * (attempt + 1));
  }
}

async function liveManifest(legacy = false) {
  const response = await request(`${ORIGIN}${MANIFEST_PATH}`, {
    cache: "no-store",
  });
  if (
    legacy &&
    (response.status === 404 ||
      (response.ok &&
        response.headers.get("content-type")?.includes("text/html")))
  )
    return null;
  if (!response.ok) throw new Error(`Live manifest HTTP ${response.status}`);
  return validateManifest(await response.json());
}

const [
  mode,
  snapshot = "/tmp/readaware-search-before.json",
  checkpoint = "/tmp/readaware-search-ack.json",
] = process.argv.slice(2);
if (mode === "snapshot") {
  const previous = await liveManifest(true);
  let acknowledged = null;
  try {
    acknowledged = validateManifest(
      JSON.parse(await readFile(checkpoint, "utf8")),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(
    snapshot,
    JSON.stringify({ deployed: previous, acknowledged }),
  );
  console.log(`Saved ${previous?.pages.length ?? 0} previously deployed pages`);
} else if (mode === "submit") {
  const current = validateManifest(
    JSON.parse(
      await readFile(
        new URL("../dist/search-manifest.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const { deployed, acknowledged } = JSON.parse(
    await readFile(snapshot, "utf8"),
  );
  let live;
  for (let attempt = 0; attempt < 6; attempt++) {
    live = await liveManifest(true);
    if (live && changedUrls(live, current).length === 0) break;
    if (attempt === 5)
      throw new Error(
        "Production does not match this build; no URLs submitted",
      );
    await sleep(5000);
  }
  const key = await request(`${ORIGIN}/${INDEXNOW_KEY}.txt`);
  if (!key.ok || (await key.text()).trim() !== INDEXNOW_KEY)
    throw new Error("Production IndexNow key verification failed");
  const urls = submissionUrls(deployed, acknowledged, current);
  for (let offset = 0; offset < urls.length; offset += 10_000) {
    const response = await request("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host: new URL(ORIGIN).host,
        key: INDEXNOW_KEY,
        keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`,
        urlList: urls.slice(offset, offset + 10_000),
      }),
    });
    if (![200, 202].includes(response.status))
      throw new Error(
        `IndexNow HTTP ${response.status}; deployment succeeded but notification failed`,
      );
    console.log(
      `IndexNow HTTP ${response.status}: ${Math.min(10_000, urls.length - offset)} changed URLs received, not an indexing guarantee`,
    );
  }
  if (!urls.length) console.log("No content changes; no IndexNow submission");
  await writeFile(checkpoint, JSON.stringify(current));
} else {
  throw new Error(
    "Usage: bun scripts/indexnow.mjs <snapshot|submit> [snapshot-file] [checkpoint-file]",
  );
}

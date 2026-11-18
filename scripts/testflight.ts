/**
 * Hand an uploaded iOS build to public TestFlight: wait until App Store
 * Connect has processed it, give it What to Test text, add it to the public
 * (external) beta group and submit it for Beta App Review. Run by
 * .github/workflows/testflight.yml after `altool` has uploaded the IPA.
 *
 * bun scripts/testflight.ts --version 0.6.11 --build-number 202611181230 --tag v0.6.11 [--dry-run]
 *
 * Environment: APPLE_API_ISSUER, APPLE_API_KEY (key id) and APPLE_API_KEY_PATH
 * (the .p8 private key), the same App Store Connect API key the signed build
 * and the upload use.
 *
 * The build is identified by its version AND build number, never as "the
 * newest build of this version": a version that already has a processed build
 * (a re-cut tag, a manual upload) would otherwise hand the wrong build to
 * review. Every step reads state first and skips work already done, so a
 * re-run after a partial failure finishes the job without duplicating it, and
 * What to Test that a person already wrote in App Store Connect is kept.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const APP_ID = "6807280649";
const API = "https://api.appstoreconnect.apple.com/v1";
const RELEASES = "https://github.com/ahpxex/read-aware/releases/tag";
const CHANGELOG = "https://readaware.app/changelog/";
/** Apple usually processes a build in 5–15 minutes; past this something is wrong. */
const PROCESSING_TIMEOUT_MS = 60 * 60 * 1000;
const POLL_MS = 30 * 1000;

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    "build-number": { type: "string" },
    tag: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const version = required(values.version, "--version");
const buildNumber = required(values["build-number"], "--build-number");
const tag = required(values.tag, "--tag");
const dryRun = values["dry-run"];

const issuer = required(process.env.APPLE_API_ISSUER, "APPLE_API_ISSUER");
const keyId = required(process.env.APPLE_API_KEY, "APPLE_API_KEY");
const signingKey = await importKey(
  readFileSync(required(process.env.APPLE_API_KEY_PATH, "APPLE_API_KEY_PATH"), "utf8"),
);

type Resource = { id: string; type: string; attributes: Record<string, unknown> };
type Document = { data: Resource | Resource[]; included?: Resource[] };

const build = await waitForProcessedBuild();
console.log(`Build ${build.id} (${version} build ${buildNumber}) is VALID`);
await setWhatToTest(build.id);
await addToPublicGroup(build.id);
await submitForBetaReview(build.id);

async function waitForProcessedBuild(): Promise<Resource> {
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  for (;;) {
    const found = await call<Document>(
      "GET",
      `/builds?filter[app]=${APP_ID}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}` +
        `&filter[version]=${encodeURIComponent(buildNumber)}&limit=2`,
    );
    const builds = found.data as Resource[];
    if (builds.length > 1) throw new Error(`More than one build is numbered ${version} (${buildNumber})`);
    const state = (builds[0] && text(builds[0], "processingState")) || undefined;
    if (state === "VALID") return builds[0]!;
    if (state === "FAILED" || state === "INVALID") {
      throw new Error(`App Store Connect rejected build ${version} (${buildNumber}): ${state}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Build ${version} (${buildNumber}) was not processed within an hour (${state ?? "not listed"})`);
    }
    console.log(`Waiting for App Store Connect: ${state ?? "not listed yet"}`);
    await Bun.sleep(POLL_MS);
  }
}

async function setWhatToTest(buildId: string) {
  const text = [
    `ReadAware ${version}.`,
    `What changed in this release: ${CHANGELOG}`,
    `Full release notes: ${RELEASES}/${tag}`,
    "Please try what the notes describe, and send feedback or a screenshot from TestFlight when something looks wrong.",
  ].join("\n");
  const localizations = (await call<Document>("GET", `/builds/${buildId}/betaBuildLocalizations`)).data as Resource[];
  const english = localizations.find((localization) => localization.attributes.locale === "en-US");
  const current = english?.attributes.whatsNew;
  if (typeof current === "string" && current.trim() !== "") {
    console.log("What to Test is already written; keeping it");
    return;
  }
  if (dryRun) return console.log("[dry run] would set What to Test");
  if (english) {
    await call("PATCH", `/betaBuildLocalizations/${english.id}`, {
      data: { type: "betaBuildLocalizations", id: english.id, attributes: { whatsNew: text } },
    });
  } else {
    await call("POST", "/betaBuildLocalizations", {
      data: {
        type: "betaBuildLocalizations",
        attributes: { locale: "en-US", whatsNew: text },
        relationships: { build: { data: { type: "builds", id: buildId } } },
      },
    });
  }
  console.log("What to Test set");
}

async function addToPublicGroup(buildId: string) {
  const groups = (await call<Document>("GET", `/betaGroups?filter[app]=${APP_ID}&limit=50`)).data as Resource[];
  // The public group is the external one with the invitation link the
  // website and README publish; internal groups receive every build anyway.
  const publicGroups = groups.filter(
    (group) => !group.attributes.isInternalGroup && group.attributes.publicLinkEnabled,
  );
  if (publicGroups.length !== 1) {
    throw new Error(`Expected exactly one external group with a public link, found ${publicGroups.length}`);
  }
  const group = publicGroups[0]!;
  // A build's own betaGroups relationship is write-only; ask the other way.
  const members = (await call<Document>("GET", `/builds?filter[betaGroups]=${group.id}&filter[id]=${buildId}&limit=1`))
    .data as Resource[];
  if (members.length > 0) {
    console.log(`Already in "${text(group, "name")}"`);
    return;
  }
  if (dryRun) return console.log(`[dry run] would add to "${text(group, "name")}"`);
  await call("POST", `/betaGroups/${group.id}/relationships/builds`, { data: [{ type: "builds", id: buildId }] });
  console.log(`Added to "${text(group, "name")}"`);
}

async function submitForBetaReview(buildId: string) {
  const detail = await call<Document>("GET", `/builds/${buildId}?include=betaAppReviewSubmission`);
  const submission = detail.included?.find((resource) => resource.type === "betaAppReviewSubmissions");
  if (submission) {
    console.log(`Already submitted for Beta App Review: ${text(submission, "betaReviewState")}`);
    return;
  }
  if (dryRun) return console.log("[dry run] would submit for Beta App Review");
  const created = await call<Document>("POST", "/betaAppReviewSubmissions", {
    data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: buildId } } } },
  });
  console.log(`Submitted for Beta App Review: ${text(created.data as Resource, "betaReviewState")}`);
}

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  // Reads are retried through transient network or server failures; a write
  // is sent once, because a retried POST could act twice.
  const attempts = method === "GET" ? 4 : 1;
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(API + path, {
        method,
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(`${method} ${path} failed (${String(error)}); retrying`);
      await Bun.sleep(10_000 * attempt);
      continue;
    }
    if (response.status >= 500 && attempt < attempts) {
      console.warn(`${method} ${path} answered ${response.status}; retrying`);
      await Bun.sleep(10_000 * attempt);
      continue;
    }
    const raw = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${raw.slice(0, 800)}`);
    return (raw ? JSON.parse(raw) : {}) as T;
  }
}

/** A fresh ES256 token per request: App Store Connect rejects tokens older than 20 minutes. */
async function token(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const input = `${header}.${claims}`;
  // Web Crypto's ECDSA signature is already the raw r||s form JWS expects.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

function importKey(pem: string): Promise<CryptoKey> {
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

/** A string attribute of an App Store Connect resource, or "" when it is absent or not a string. */
function text(resource: Resource, key: string): string {
  const value = resource.attributes[key];
  return typeof value === "string" ? value : "";
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

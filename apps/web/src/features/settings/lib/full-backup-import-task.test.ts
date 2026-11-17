import { actorCause, causalActor, eventCause } from "../../../platform/domain-actor";
import type { applyFullBackup } from "./full-backup-apply";
import { expect, test } from "bun:test";
import { createFullBackupImport, type BackupPlanReceipt, type BackupSourceReceipt } from "./full-backup-import-task";
import type { BackupReviewPage, BackupReviewQuery } from "./backup-review-types";

const source: BackupSourceReceipt = {
  taskId: "task",
  format: 2,
  schemaVersion: 42,
  tables: { books: 1 },
  events: 1,
  blobs: 1,
  credentials: 0,
  pluginPrograms: 0,
};
const plan: BackupPlanReceipt = {
  taskId: "task",
  newEvents: 1,
  existingEvents: 0,
  conflictingEvents: 0,
  tables: {},
  files: { sourceOnly: 1, targetOnly: 0, same: 0, different: 0, unavailable: 0 },
  pluginPrograms: 0,
};
function fixture() {
  const calls: string[] = [];
  const deps = {
    id: () => "task",
    selectSource: async (): Promise<string | null> => {
      calls.push("pick");
      return "/source.age";
    },
    open: async (_id: string, path: string, password: string): Promise<BackupSourceReceipt> => {
      expect([path, password]).toEqual(["/source.age", "a test password"]);
      calls.push("open");
      return source;
    },
    plan: async (): Promise<BackupPlanReceipt> => {
      calls.push("plan");
      return plan;
    },
    read: async (_id: string, query: BackupReviewQuery): Promise<BackupReviewPage> => {
      calls.push("read");
      return { kind: query.kind, entries: [], nextAfter: null } as BackupReviewPage;
    },
    stageProgram: async () => ({ token: "stage", storage: {} }),
    stageStorage: async <T>() => null as T,
    apply: async (..._args: Parameters<typeof applyFullBackup>) => ({
      taskId: "task",
      format: 2 as const,
      restoreId: "restore",
      domainRows: 1,
      files: 0,
      plugins: 0,
      credentials: 0,
      cleanupPending: false,
    }),
    cancel: async () => {
      calls.push("cancel");
    },
    warn: (_message: string, _error: unknown) => {
      calls.push("warn");
    },
  };
  return { deps, calls, run: createFullBackupImport(deps) };
}
test("import preparation retains only a count review and native lifetime, then disposes once", async () => {
  const { run, calls } = fixture();
  const review = (await run("a test password"))!;
  expect(calls).toEqual(["pick", "open", "plan"]);
  expect(Object.keys(review.source)).not.toContain("taskId");
  expect(Object.keys(review.plan)).not.toContain("taskId");
  expect(JSON.stringify(review)).not.toContain("/source.age");
  expect(JSON.stringify(review)).not.toContain("password");
  expect(review.disposed).toBe(false);
  await Promise.all([review.dispose(), review.dispose()]);
  expect(review.disposed).toBe(true);
  expect(calls.at(-1)).toBe("cancel");
  expect(calls.filter((value) => value === "cancel")).toHaveLength(1);
});
test("abort waits for physical decryption before retrying cancellation, never plans its source", async () => {
  const { deps, run, calls } = fixture();
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<BackupSourceReceipt>();
  deps.open = async () => {
    entered.resolve();
    return release.promise;
  };
  let done = false;
  const pending = run("a test password", controller.signal).catch((error) => {
    done = true;
    return error;
  });
  await entered.promise;
  controller.abort();
  await Bun.sleep(0);
  expect(done).toBe(false);
  release.resolve(source);
  expect((await pending).name).toBe("AbortError");
  expect(calls).not.toContain("plan");
  expect(calls.filter((value) => value === "cancel")).toHaveLength(2);
});
test("abort during plan retains physical completion; abort during review disposes the retained native task", async () => {
  const { deps, run, calls } = fixture();
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<BackupPlanReceipt>();
  deps.plan = async () => {
    entered.resolve();
    return release.promise;
  };
  let done = false;
  const pending = run("a test password", controller.signal).catch((error) => {
    done = true;
    return error;
  });
  await entered.promise;
  controller.abort();
  await Bun.sleep(0);
  expect(done).toBe(false);
  release.resolve(plan);
  expect((await pending).name).toBe("AbortError");
  expect(calls.filter((value) => value === "cancel")).toHaveLength(2);
  const next = fixture(),
    owner = new AbortController();
  const review = (await next.run("a test password", owner.signal))!;
  owner.abort();
  await review.dispose();
  expect(review.disposed).toBe(true);
  expect(next.calls.at(-1)).toBe("cancel");
});
test("cancelled file choice does not reserve; mismatched receipts and plan failures release preparation", async () => {
  const { deps, run, calls } = fixture();
  await expect(run("short")).rejects.toMatchObject({ code: "backup/password-policy" });
  expect(calls).toEqual([]);
  deps.selectSource = async () => null;
  expect(await run("a test password")).toBeNull();
  expect(calls).toEqual([]);
  deps.selectSource = async () => "/source.age";
  deps.open = async () => ({ ...source, taskId: "foreign" });
  await expect(run("a test password")).rejects.toMatchObject({ code: "backup/changed" });
  expect(calls).toEqual(["cancel"]);
  deps.open = async () => source;
  deps.plan = async () => {
    throw new Error("plan failed");
  };
  await expect(run("a test password")).rejects.toThrow("plan failed");
  expect(calls).toEqual(["cancel", "cancel"]);
});

test("review reads serialize snapshots of page requests; an individual cancellation preserves the plan", async () => {
  const { deps, run, calls } = fixture();
  const first = Promise.withResolvers<BackupReviewPage>(),
    entered = Promise.withResolvers<void>();
  const seen: BackupReviewQuery[] = [];
  deps.read = async (_id, query) => {
    seen.push(query);
    if (seen.length === 1) {
      entered.resolve();
      return first.promise;
    }
    return { kind: "files", entries: [], nextAfter: null };
  };
  const review = (await run("a test password"))!;
  const owner = new AbortController();
  const one = review.read({ kind: "events", limit: 1 }, owner.signal).catch((error) => error);
  await entered.promise;
  const candidate: BackupReviewQuery = { kind: "files", after: "books", limit: 1 };
  const two = review.read(candidate);
  candidate.after = "memories";
  owner.abort();
  await Bun.sleep(0);
  expect(seen).toHaveLength(1);
  first.resolve({ kind: "events", entries: [], nextAfter: null });
  expect((await one).name).toBe("AbortError");
  expect((await two).kind).toBe("files");
  expect(seen[1]).toMatchObject({ after: "books" });
  expect(calls).not.toContain("cancel");
  deps.read = async () => {
    throw new Error("bad page");
  };
  await expect(review.read({ kind: "files", after: "missing", limit: 1 })).rejects.toThrow("bad page");
  deps.read = async () => ({ kind: "programs", entries: [], nextAfter: null });
  expect((await review.read({ kind: "programs", limit: 1 })).kind).toBe("programs");
  await review.dispose();
});

test("review disposal waits for the native read, discards queued reads, and bounds admission", async () => {
  const { deps, run, calls } = fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<BackupReviewPage>();
  let physicalReads = 0;
  deps.read = async () => {
    physicalReads++;
    entered.resolve();
    return release.promise;
  };
  const review = (await run("a test password"))!;
  const pending = Array.from({ length: 32 }, () => review.read({ kind: "files", limit: 1 }).catch((error) => error));
  await entered.promise;
  await expect(review.read({ kind: "files", limit: 1 })).rejects.toMatchObject({ code: "backup/busy" });
  let disposed = false;
  const closing = review.dispose().then(() => {
    disposed = true;
  });
  await Bun.sleep(0);
  expect(disposed).toBe(false);
  expect(calls).toContain("cancel");
  release.resolve({ kind: "files", entries: [], nextAfter: null });
  await closing;
  expect(physicalReads).toBe(1);
  expect((await Promise.all(pending)).every((result) => result.code === "backup/changed")).toBe(true);
  await expect(review.read({ kind: "files", limit: 1 })).rejects.toMatchObject({ code: "backup/changed" });
});

test("restore consumes review once and retains the committed receipt through late cancellation", async () => {
  const { deps, run } = fixture();
  const entered = Promise.withResolvers<void>();
  const decision = Promise.withResolvers<Awaited<ReturnType<typeof deps.apply>>>();
  const origin = causalActor("user");
  deps.apply = async (_id, _request, _progress, _signal, accepted) => {
    expect(actorCause(accepted)).toEqual(actorCause(origin));
    entered.resolve();
    return decision.promise;
  };
  const review = (await run("a test password"))!;
  const request = { files: {}, programs: {}, programResults: {}, credentials: {} };
  const applied = review.apply(request, origin);
  await entered.promise;
  await expect(review.apply(request)).rejects.toMatchObject({ code: "backup/changed" });
  await expect(review.read({ kind: "files", limit: 1 })).rejects.toMatchObject({ code: "backup/changed" });
  let closed = false;
  const disposing = review.dispose().then(() => {
    closed = true;
  });
  await Bun.sleep(0);
  expect(closed).toBe(false);
  decision.resolve({
    taskId: "task",
    format: 2,
    restoreId: "restore",
    domainRows: 3,
    files: 1,
    plugins: 0,
    credentials: 0,
    cleanupPending: false,
  });
  expect(await applied).toMatchObject({ format: 2, domainRows: 3 });
  expect(eventCause(await applied)).toEqual(actorCause(origin));
  expect(JSON.stringify(await applied)).not.toContain("taskId");
  await disposing;
  expect(closed).toBe(true);
});

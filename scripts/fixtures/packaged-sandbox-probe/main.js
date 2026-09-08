// Manual release-only diagnostic. This is not a product plugin or a sandbox proof.
const endpoint = "http://127.0.0.1:18886";
const results = [];

async function check(name, run) {
  try {
    results.push({ name, result: String(await run()) });
  } catch (error) {
    results.push({ name, result: `${error.name}: ${error.message}` });
  }
}

async function request(fetcher, name) {
  const response = await fetcher(`${endpoint}/probe/${name}`, { signal: AbortSignal.timeout(2000) });
  return `NETWORK REACHED: ${response.status} ${await response.text()}`;
}

async function runChecks(ctx) {
  results.length = 0;
  await check("granted network service", () => typeof ctx.services.network);
  await check("global fetch", () => request(fetch, "global-fetch"));
  await check("prototype fetch", async () => {
    for (let proto = Object.getPrototypeOf(globalThis); proto; proto = Object.getPrototypeOf(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, "fetch");
      if (typeof descriptor?.value === "function") return request(descriptor.value.bind(globalThis), "prototype-fetch");
    }
    return "No prototype fetch found";
  });
  await check("child blob Worker", () => new Promise((resolve, reject) => {
    let worker;
    let url;
    const cleanup = () => { clearTimeout(timer); worker?.terminate(); if (url) URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Child timeout")); }, 3000);
    try {
      url = URL.createObjectURL(new Blob([
        `fetch(${JSON.stringify(`${endpoint}/probe/child-worker`)}).then(r=>r.text()).then(value=>postMessage("NETWORK REACHED: "+value),error=>postMessage(error.name+": "+error.message));`,
      ], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = event => { cleanup(); resolve(event.data); };
      worker.onerror = event => { cleanup(); reject(new Error(event.message || "Child worker error")); };
    } catch (error) { cleanup(); reject(error); }
  }));
  await check("HTTP dynamic module", async () => {
    const module = await import(`${endpoint}/probe/module.js`);
    return `NETWORK REACHED: ${module.probe}`;
  });
  return { view: view(ctx), navigation: "replace" };
}

function view(ctx) {
  return { kind: "list", title: "Zero-permission sandbox checks", emptyText: "Not run",
    actions: [{ id: "run", label: "Run loopback checks", run: () => runChecks(ctx) }],
    items: results.map(({ name, result }, index) => ({ id: String(index), title: name, subtitle: result })) };
}

export default {
  activate(ctx) {
    ctx.contributions.headerActions.register({ id: "probe", title: "Packaged Sandbox Probe", icon: "shield-check",
      surface: "shelf", presentation: "page", view: () => view(ctx) });
  },
};

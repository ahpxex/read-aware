export default {
  activate(ctx) {
    let result = "Not run";
    const view = () => ({ kind: "list", title: "Granted network control",
      items: [{ id: "result", title: result }],
      actions: [{ id: "run", label: "Run host network control", run: async () => {
        const response = await ctx.services.network.fetch("http://127.0.0.1:18886/probe/host-network", {
          signal: AbortSignal.timeout(2000),
        });
        result = `HOST NETWORK: ${response.status} ${await response.text()}`;
        return { view: view(), navigation: "replace" };
      } }],
    });
    ctx.contributions.headerActions.register({ id: "probe", title: "Packaged Network Probe", icon: "shield-check",
      surface: "shelf", presentation: "page", view });
  },
};

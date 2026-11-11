window.codexPlus.extension(async (ctx) => {
  let status = { active: false };
  let busy = false;
  const sync = async () => {
    status = await ctx.backend.call("sync");
    if (status.configuredActive && !status.active) {
      throw new Error(`ImageGen compatibility: ${status.reports.map((item) => `${item.id}: ${item.status}`).join(", ")}`);
    }
    return status;
  };
  ctx.registerMenuItem({
    label: "\u539f\u751f\u751f\u56fe\u517c\u5bb9\u4fee\u590d",
    description: "Native ImageGen Compatibility",
    toggleValue: () => status.active,
    onChange: async (active) => {
      if (busy) return;
      busy = true;
      try {
        status = await ctx.backend.call("setActive", { active });
        if (active && !status.active) throw new Error("Provider headers changed; inspect the extension status.");
        const preserved = status.reports.some((item) => item.conflicts.length);
        ctx.toast(active ? "\u751f\u56fe\u517c\u5bb9\u4fee\u590d\u5df2\u542f\u7528"
          : preserved ? "\u4fee\u590d\u5df2\u5173\u95ed\uff0c\u4fdd\u7559\u4e86\u624b\u52a8\u4fee\u6539\u7684\u503c"
          : "\u4fee\u590d\u5df2\u5173\u95ed\uff0c\u539f\u59cb\u8bf7\u6c42\u5934\u5df2\u6062\u590d");
      } finally { busy = false; }
    },
  });
  ctx.registerMenuItem({
    label: "\u68c0\u67e5\u751f\u56fe\u4fee\u590d\u72b6\u6001",
    buttonLabel: "\u68c0\u67e5",
    onActivate: async () => {
      const result = await sync();
      ctx.toast(`${result.active ? "Active" : "Off"}: ${result.providerIds.join(", ")}`);
    },
  });
  // Reconcile before a new user turn, rather than launching middleware for every LLM request.
  ctx.intercept("codex/request", async (value, next) => {
    if (["turn/start", "turn/steer"].includes(value.method)) {
      try { await sync(); } catch (error) { ctx.fail(error); }
    }
    return next(value);
  });
  await sync();
});

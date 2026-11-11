import { readFile, writeFile, rename, unlink, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { DEFAULTS, KEY, settings, transition } from "./patch.mjs";

export async function readJson(path, fallback) {
  try { return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")); }
  catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return structuredClone(fallback);
    throw error;
  }
}

async function replaceJson(path, value, expectedText) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    if (expectedText !== undefined && await readFile(path, "utf8") !== expectedText) {
      throw new Error("Configuration changed concurrently; retry after the manager finishes saving.");
    }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

export function paths(dataDir, base = homedir()) {
  const manager = process.env.APPDATA ? join(process.env.APPDATA, "Codex++") : join(base, ".config", "Codex++");
  return {
    dataDir,
    gateway: join(base, ".codex-session-delete", "gateway.json"),
    scripts: join(manager, "user_scripts.json"),
    state: join(dataDir, "identity-backup.json"),
    lock: join(dataDir, "patch.lock"),
  };
}

export async function createMethods({ dataDir, config = {}, files = paths(dataDir) }) {
  await mkdir(files.dataDir, { recursive: true });
  let queue = Promise.resolve();
  const serialize = (operation) => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  const locked = async (operation) => {
    let lock;
    try {
      lock = await open(files.lock, "wx", 0o600);
      await lock.writeFile(String(process.pid));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(await readFile(files.lock, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid patch lock; inspect patch.lock.");
      try { process.kill(pid, 0); }
      catch (probeError) {
        if (probeError.code !== "ESRCH") throw probeError;
        await unlink(files.lock);
        return locked(operation);
      }
      throw new Error("Another extension instance is updating the patch; retry.");
    }
    try { return await operation(); }
    finally { await lock.close(); await unlink(files.lock); }
  };
  const loadConfig = async () => {
    const saved = await readJson(files.scripts);
    return settings({ ...DEFAULTS, ...config, ...saved.configs?.[KEY] });
  };
  const reconcile = async () => {
    const currentConfig = await loadConfig();
    const text = await readFile(files.gateway, "utf8");
    const gateway = JSON.parse(text.replace(/^\uFEFF/, ""));
    const state = await readJson(files.state, { version: 1, providers: {} });
    if (state.gatewayPath && state.gatewayPath !== files.gateway) throw new Error("Backup belongs to a different gateway.");
    const result = transition(gateway, state, currentConfig);
    result.state.gatewayPath = files.gateway;
    if (result.changed && currentConfig.active) {
      // Persist the small recovery record before writing provider configuration.
      await replaceJson(files.state, result.state);
    }
    if (result.changed) await replaceJson(files.gateway, result.gateway, text);
    await replaceJson(files.state, result.state);
    return {
      active: result.active,
      configuredActive: currentConfig.active,
      providerIds: currentConfig.providerIds,
      reports: result.reports,
      changed: result.changed,
    };
  };
  return {
    sync: () => serialize(() => locked(reconcile)),
    setActive: ({ active }) => serialize(() => locked(async () => {
      if (typeof active !== "boolean") throw new Error("active must be boolean.");
      const text = await readFile(files.scripts, "utf8");
      const saved = JSON.parse(text.replace(/^\uFEFF/, ""));
      saved.configs ??= {};
      saved.configs[KEY] = { ...saved.configs[KEY], active };
      await replaceJson(files.scripts, saved, text);
      return reconcile();
    })),
  };
}

export default createMethods;

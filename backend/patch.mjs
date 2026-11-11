import { isDeepStrictEqual as equal } from "node:util";

export const ID = "native-imagegen-compat";
export const KEY = `user:${ID}`;
export const DEFAULTS = Object.freeze({
  active: false,
  providerIds: [],
  originator: "CodexPlusPlus",
  userAgent: "CodexPlusPlus/2.6.2",
});

const isOriginator = (header) => String(header?.key ?? "").trim().toLowerCase() === "originator";
const origins = (relay) => (relay.customHeaders ?? []).filter(isOriginator);

export function snapshot(relay) {
  if (relay.customHeaders != null && !Array.isArray(relay.customHeaders)) {
    throw new Error("Provider customHeaders must be an array.");
  }
  return structuredClone({
    hadUserAgent: Object.hasOwn(relay, "userAgent"),
    userAgent: relay.userAgent ?? null,
    hadCustomHeaders: Object.hasOwn(relay, "customHeaders"),
    originatorHeaders: origins(relay),
  });
}

export function settings(value = {}) {
  const config = { ...DEFAULTS, ...value };
  if (typeof config.active !== "boolean") throw new Error("active must be boolean.");
  if (!Array.isArray(config.providerIds) || (config.active && !config.providerIds.length) ||
      config.providerIds.some((id) => typeof id !== "string" || !/^[\w.-]+$/.test(id))) {
    throw new Error("Specify at least one valid provider ID.");
  }
  config.providerIds = [...new Set(config.providerIds)];
  for (const name of ["originator", "userAgent"]) {
    if (typeof config[name] !== "string" || !/^[\x20-\x7e]{1,256}$/.test(config[name]) ||
        !config[name].trim()) throw new Error(`${name} must be a nonempty ASCII header value.`);
    config[name] = config[name].trim();
  }
  return config;
}

export function transition(inputGateway, inputState, rawConfig) {
  const config = settings(rawConfig);
  const gateway = structuredClone(inputGateway);
  const state = structuredClone(inputState ?? { version: 1, providers: {} });
  if (!Array.isArray(gateway.providers) || state.version !== 1 ||
      !state.providers || Array.isArray(state.providers)) throw new Error("Invalid gateway or backup format.");
  const reports = [];
  const find = (id) => {
    const matches = gateway.providers.filter((provider) => provider?.relay?.id === id);
    if (matches.length > 1) throw new Error(`Duplicate provider ID: ${id}`);
    return matches[0]?.relay;
  };
  const allowed = (relay) => relay?.relayMode === "pureApi" && !relay.officialMixApiKey;
  const desired = {
    userAgent: config.userAgent,
    originatorHeaders: [{ key: "originator", value: config.originator }],
  };
  const restore = (id, entry) => {
    const relay = find(id);
    const conflicts = [];
    if (relay && allowed(relay)) {
      // Restore each field only while it still has our value.
      if (relay.userAgent === entry.applied.userAgent) {
        if (entry.before.hadUserAgent) relay.userAgent = entry.before.userAgent;
        else delete relay.userAgent;
      } else if (relay.userAgent !== entry.before.userAgent &&
          !(relay.userAgent === undefined && !entry.before.hadUserAgent)) {
        conflicts.push("userAgent");
      }
      if (equal(origins(relay), entry.applied.originatorHeaders)) {
        relay.customHeaders = [
          ...(relay.customHeaders ?? []).filter((header) => !isOriginator(header)),
          ...entry.before.originatorHeaders,
        ];
        if (!entry.before.hadCustomHeaders && relay.customHeaders.length === 0) delete relay.customHeaders;
      } else if (!equal(origins(relay), entry.before.originatorHeaders)) {
        conflicts.push("originator");
      }
    } else if (relay) conflicts.push("providerMode");
    delete state.providers[id];
    reports.push({ id, status: conflicts.length ? "preserved-user-changes" : "restored", conflicts });
    return conflicts;
  };
  const blocked = new Set();
  for (const [id, entry] of Object.entries(state.providers)) {
    if (!config.active || !config.providerIds.includes(id) || !equal(entry.applied, desired)) {
      if (restore(id, entry).length) blocked.add(id);
    }
  }
  if (config.active) {
    // Validate every target before mutating any new provider.
    for (const id of config.providerIds) {
      const relay = find(id);
      if (!relay) throw new Error(`Provider not found: ${id}`);
      if (!allowed(relay)) throw new Error(`Only pureApi providers without officialMixApiKey are supported: ${id}`);
      snapshot(relay);
    }
    for (const id of config.providerIds) {
      if (blocked.has(id)) continue;
      const relay = find(id);
      const entry = state.providers[id];
      if (entry) {
        const conflicts = [];
        if (relay.userAgent !== entry.applied.userAgent) conflicts.push("userAgent");
        if (!equal(origins(relay), entry.applied.originatorHeaders)) conflicts.push("originator");
        reports.push({ id, status: conflicts.length ? "conflict" : "active", conflicts });
        continue;
      }
      state.providers[id] = { before: snapshot(relay), applied: structuredClone(desired) };
      relay.userAgent = config.userAgent;
      relay.customHeaders = [
        ...(relay.customHeaders ?? []).filter((header) => !isOriginator(header)),
        ...desired.originatorHeaders,
      ];
      reports.push({ id, status: "active", conflicts: [] });
    }
  }
  return {
    gateway, state, reports,
    changed: !equal(gateway, inputGateway),
    active: config.active && config.providerIds.every((id) =>
      reports.some((report) => report.id === id && report.status === "active")),
  };
}

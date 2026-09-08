import { existsSync } from "node:fs";
import { HOST_CAPABILITY_CATALOG } from "../packages/core/src/capabilities";
import { baselineCoverage, groups, sources } from "../docs/host-capability-matrix.data";
import { evidence, scenarioCoverage, scenarios, units, type Unit } from "../docs/host-capability-model.data";

export function validateModel(model: Unit[] = units) {
  const rows = groups.flatMap(g => g.rows);
  const rowIds = new Set(rows.map(r => r.id));
  const unitIds = new Set(model.map(u => u.id));
  if (unitIds.size !== model.length) throw new Error("Duplicate model unit");
  const owners = new Map<string, string[]>();
  const catalog = new Map<string, string>();
  for (const u of model) {
    for (const field of [u.owner, u.title, u.operations, u.agent, u.plugin, u.limits, u.acceptance]) {
      if (!field.trim()) throw new Error(`Missing contract in ${u.id}`);
    }
    if (!u.refs.length || new Set(u.refs).size !== u.refs.length) throw new Error(`Invalid evidence list ${u.id}`);
    for (const ref of u.refs) {
      if (!rowIds.has(ref)) throw new Error(`Unknown evidence ${ref}`);
      owners.set(ref, [...(owners.get(ref) ?? []), u.id]);
    }
    for (const entry of u.catalog) {
      const family = { Domain: "domains", Contribution: "contributions", Service: "services", Schema: "schemas" }[u.family as "Domain" | "Contribution" | "Service" | "Schema"];
      if (!family || !entry.startsWith(`${family}.`)) throw new Error(`Incorrect semantic family ${entry} in ${u.id}`);
      if (catalog.has(entry)) throw new Error(`Duplicate catalog owner ${entry}`);
      catalog.set(entry, u.id);
    }
  }
  for (const row of rows) {
    if (!owners.has(row.id)) throw new Error(`Unmodeled row ${row.id}`);
    for (const source of row.sources) if (!sources[source] || !existsSync(sources[source])) throw new Error(`Missing source ${source}`);
  }
  const actual = Object.entries(HOST_CAPABILITY_CATALOG).flatMap(([family, entries]) => Object.keys(entries).map(id => `${family}.${id}`));
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...catalog.keys()].sort())) throw new Error("Runtime catalog model drift");
  for (const [id, refs] of Object.entries(baselineCoverage)) {
    if (!refs.length || refs.some(ref => !owners.has(ref))) throw new Error(`Unmodeled baseline ${id}`);
  }
  for (const [id, refs] of Object.entries(scenarioCoverage)) {
    if (!refs.length || refs.some(ref => !unitIds.has(ref))) throw new Error(`Invalid scenario ${id}`);
  }
  for (const [name, refs] of scenarios) if (refs.split(" ").some(ref => !unitIds.has(ref))) throw new Error(`Invalid workflow ${name}`);
  for (const path of evidence) if (!existsSync(path)) throw new Error(`Missing deep-audit evidence ${path}`);
  return { rows, owners, catalog };
}

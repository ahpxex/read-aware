import { expect, test } from "bun:test";
import { HOST_COMMAND_IDS } from "../packages/core/src/host-commands";
import { collectInventory } from "./host-capability-inventory";

test("semantic commands retain explicit audit mappings after native callback removal", () => {
  const inventory = collectInventory();
  const commands = inventory.filter(item => item.family === "Host semantic command");
  expect(commands.map(item => item.name)).toEqual([...HOST_COMMAND_IDS]);
  expect(commands).toHaveLength(18);
  expect(commands.every(item => item.rows.includes("UI03"))).toBe(true);
  expect(commands.find(item => item.name === "open-book")!.rows).toContain("READ01");
  expect(inventory.filter(item => item.family === "Command action").map(item => item.name)).toEqual(["importBook"]);
});

test("a new semantic command cannot silently inherit a catch-all audit mapping", () => {
  const ids = HOST_COMMAND_IDS as unknown as string[];
  ids.push("audit-unmapped-command");
  try { expect(() => collectInventory()).toThrow("Unmapped Host semantic command: audit-unmapped-command"); }
  finally { ids.pop(); }
});

test("memory query and consumer inventories stay distinct from bundled or model tools", () => {
  const inventory = collectInventory();
  expect(inventory.find(item => item.family === "Plugin ctx" && item.name === "domains.memory.queries.search")?.rows).toEqual(["MEM01"]);
  expect(inventory.find(item => item.family === "Plugin ctx" && item.name === "domains.memory.queries.bookGraph")?.rows).toEqual(["MEM11"]);
  expect(inventory.find(item => item.family === "First-party source plugin" && item.name === "memory-desk")?.rows).toContain("MEM11");
  expect(inventory.some(item => item.family === "Native bundled plugin" && item.name === "memory-desk")).toBe(false);
  expect(inventory.some(item => item.family === "Plugin Agent contribution" && item.name.includes("memory-desk"))).toBe(false);
});

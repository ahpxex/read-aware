#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { toError } from "@read-aware/core";
import { version } from "../package.json";

try {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.version && !values.help) {
    console.log(version);
  } else {
    console.log(`ReadAware CLI

Usage: read-aware [options]

Options:
  -h, --help     Show this help
  -v, --version  Show the version`);
  }
} catch (error) {
  console.error(toError(error));
  console.error("Invalid arguments. Run read-aware --help for usage.");
  process.exitCode = 1;
}

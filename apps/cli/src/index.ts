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
  // Print only the message: logging the Error object makes Bun dump a source
  // frame and stack trace, which is debugging output rather than a CLI message.
  console.error(`read-aware: ${toError(error).message}`);
  console.error("Run read-aware --help for usage.");
  process.exitCode = 1;
}

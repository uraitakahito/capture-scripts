#!/usr/bin/env node
/**
 * サイト用のスクリプト (catalog.json の sites の在る物) について、scripts/<name> に sites を書き込み、
 * generated/<name> を作る。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeSites } from "./write-sites.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
mkdirSync(join(root, "generated"), { recursive: true });
for (const script of catalog.scripts) {
  if (script.sites === undefined) continue;
  const name = basename(script.file);
  const code = readFileSync(join(root, "scripts", name), "utf8");
  writeFileSync(join(root, "generated", name), writeSites(code, script.sites));
}

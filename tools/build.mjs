#!/usr/bin/env node
/**
 * generated/<name> を作る。capture-ledger が読むのはこちら。作り直しの比較は tools/check.mjs が行う。
 *
 * - サイト用のスクリプト (catalog.json の sites の在る物): scripts/<name> に sites を書き込む
 * - 束ねるスクリプト (tools/bundle.mjs の BUNDLES): scripts/<name> を import する package ごと 1 本の JS に束ねる
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BUNDLES, bundle } from "./bundle.mjs";
import { writeSites } from "./write-sites.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
mkdirSync(join(root, "generated"), { recursive: true });
for (const script of catalog.scripts) {
  const name = basename(script.file);
  if (script.sites !== undefined) {
    const code = readFileSync(join(root, "scripts", name), "utf8");
    writeFileSync(join(root, "generated", name), writeSites(code, script.sites));
  } else if (Object.hasOwn(BUNDLES, name)) {
    writeFileSync(join(root, "generated", name), await bundle(name));
  }
}

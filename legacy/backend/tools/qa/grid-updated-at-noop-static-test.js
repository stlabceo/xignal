"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const gridEngine = fs.readFileSync(path.join(root, "grid-engine.js"), "utf8");

const mustInclude = (source, needle, message) => {
  assert(source.includes(needle), message || `missing ${needle}`);
};

mustInclude(
  gridEngine,
  "const isNoopGridPatch = async",
  "grid patch helper must compare current values before updating updatedAt"
);
mustInclude(
  gridEngine,
  "areGridPatchValuesEquivalent(current[column], patch[column])",
  "no-op detection must compare every patched column"
);
mustInclude(
  gridEngine,
  "if (await isNoopGridPatch(tableName, id, finalPatch))",
  "applyGridPatch must skip UPDATE when no semantic field changes"
);
mustInclude(
  gridEngine,
  "updatedAt = NOW()",
  "applyGridPatch must still update updatedAt when a real field changes"
);

console.log("grid-updated-at-noop-static-test PASS");

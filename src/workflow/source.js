"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeSlashPath } = require("../lib/paths");

const SOURCE_KINDS = Object.freeze(["issue", "prd", "plan", "progress", "direct-goal"]);

function isInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readRepoFile(repoRoot, requestedPath, label) {
  if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
    throw new Error(`${label} requires a repository-relative file.`);
  }
  const resolved = path.resolve(repoRoot, requestedPath);
  if (!isInside(repoRoot, resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label} must be a file inside the repository: ${requestedPath}.`);
  }
  const realRoot = fs.realpathSync(repoRoot);
  const realFile = fs.realpathSync(resolved);
  if (!isInside(realRoot, realFile)) {
    throw new Error(`${label} must resolve inside the repository: ${requestedPath}.`);
  }
  const content = fs.readFileSync(realFile);
  if (content.length > 1024 * 1024) throw new Error(`${label} exceeds 1 MiB.`);
  return {
    content,
    path: normalizeSlashPath(path.relative(realRoot, realFile)),
    sha256: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`,
  };
}

function readRepoJson(repoRoot, requestedPath, label) {
  const file = readRepoFile(repoRoot, requestedPath, label);
  try {
    return { ...file, value: JSON.parse(file.content.toString("utf8")) };
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error.message}`);
  }
}

function inferSourceKind(relativePath) {
  const name = path.basename(relativePath).toLowerCase();
  if (name === "progress.md") return "progress";
  if (name === "plan.md" || name.includes("roadmap")) return "plan";
  if (name.includes("prd") || name.includes("requirement")) return "prd";
  if (name.includes("issue")) return "issue";
  return "plan";
}

function makeSourceIdentity(repoRoot, sourcePath, sourceKind) {
  if (!sourcePath) return { kind: "direct-goal", path: null, sha256: null };
  const source = readRepoFile(repoRoot, sourcePath, "--from");
  const kind = sourceKind || inferSourceKind(source.path);
  if (!SOURCE_KINDS.includes(kind) || kind === "direct-goal") {
    throw new Error(`--source-kind must be issue, prd, plan, or progress when --from is used.`);
  }
  return { kind, path: source.path, sha256: source.sha256 };
}

module.exports = {
  SOURCE_KINDS,
  makeSourceIdentity,
  readRepoFile,
  readRepoJson,
};

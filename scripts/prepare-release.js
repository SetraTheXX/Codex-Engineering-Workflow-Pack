"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(repoRoot, "package.json"));

function buildPlan() {
  return {
    schemaVersion: "release-preparation/v1",
    packageVersion: packageJson.version,
    artifactRoot: `.cewp/release-prep/${packageJson.version}`,
    validation: ["npm run check", "npm run pack:dry-run", "git diff --check"],
    blockers: ["exact-release-matrix", "clean-release-source"],
    externalActions: ["npm-publication", "git-tag", "github-release", "remote-push"].map((id) => ({
      id,
      automatic: false,
      humanApprovalRequired: true,
    })),
  };
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed with ${result.status}.`);
}

function prepare(plan) {
  run(process.execPath, [process.env.npm_execpath, "run", "check"]);
  run(process.execPath, [process.env.npm_execpath, "run", "pack:dry-run"]);
  run("git", ["diff", "--check"]);
  const outputRoot = path.join(repoRoot, ...plan.artifactRoot.split("/"));
  fs.mkdirSync(outputRoot, { recursive: true });
  const packed = childProcess.spawnSync(process.execPath, [
    process.env.npm_execpath, "pack", "--json", "--pack-destination", outputRoot,
  ], { cwd: repoRoot, encoding: "utf8", shell: false, windowsHide: true });
  if (packed.error || packed.status !== 0) throw packed.error || new Error(packed.stderr || "package artifact preparation failed");
  const entry = JSON.parse(packed.stdout)[0];
  const artifactPath = path.join(outputRoot, entry.filename);
  const manifest = {
    ...plan,
    preparedAt: new Date().toISOString(),
    artifact: {
      file: entry.filename,
      bytes: fs.statSync(artifactPath).size,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex"),
    },
    releasePerformed: false,
  };
  fs.writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

const args = new Set(process.argv.slice(2));
const plan = buildPlan();
if (args.has("--plan")) {
  console.log(args.has("--json") ? JSON.stringify(plan, null, 2) : plan.validation.join("\n"));
} else if (!args.has("--yes")) {
  throw new Error("Release artifact preparation requires --yes; external publication, tag, push, and release remain separate human actions.");
} else {
  console.log(JSON.stringify(prepare(plan), null, 2));
}

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { redactEvidenceValue, REDACTION_SCHEMA_VERSION } = require("../evidence/redaction");
const { ensureDir } = require("../lib/fs");
const { normalizeSlashPath } = require("../lib/paths");
const { writeJsonAtomic } = require("../workflow/state");
const { validatePilotId } = require("./record");
const { derivePilotStatus, loadPilotRecords } = require("./status");

const PILOT_EXPORT_SCHEMA_VERSION = "pilot-export/v1";

function isInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function prepareContainedExportRoot(repoRoot, exportRoot) {
  const resolvedRepo = path.resolve(repoRoot);
  const resolvedExport = path.resolve(exportRoot);
  if (!isInside(resolvedRepo, resolvedExport)) throw new Error("Pilot export root must stay inside the repository.");
  const relativeParts = path.relative(resolvedRepo, resolvedExport).split(path.sep).filter(Boolean);
  let cursor = resolvedRepo;
  for (const part of relativeParts) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Pilot export refuses a symbolic link in its output path: ${normalizeSlashPath(path.relative(resolvedRepo, cursor))}.`);
    }
  }
  ensureDir(resolvedExport);
  const realRepo = fs.realpathSync(resolvedRepo);
  const realExport = fs.realpathSync(resolvedExport);
  if (!isInside(realRepo, realExport)) throw new Error("Pilot export root resolves outside the repository.");
}

function writeTextAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, value, { flag: "wx" });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function renderPilotExportMarkdown(pilotExport) {
  const lines = [
    "# CEWP Pilot Export",
    "",
    `Generated: ${pilotExport.generatedAt}`,
    `Scope: ${pilotExport.scope.pilotId || "all local pilot records"}`,
    `Phase 13 complete: ${pilotExport.status.complete ? "yes" : "no"}`,
    "",
    "## Privacy",
    "",
    `Redaction policy: ${pilotExport.redaction.schemaVersion}`,
    `Replacements: ${pilotExport.redaction.replacements}`,
    `Classes: ${pilotExport.redaction.classes.join(", ") || "none"}`,
    "Raw prompts: excluded",
    "Raw logs: excluded",
    "Source code: excluded",
    "",
    "## Gates",
    "",
    "| Gate | Observed | Required | Status |",
    "| --- | ---: | ---: | --- |",
    ...pilotExport.status.gates.map((gate) => `| ${gate.id} | ${gate.observed} | ${gate.threshold} | ${gate.status} |`),
    "",
    "## Records",
    "",
  ];
  for (const record of pilotExport.records) {
    lines.push(`### ${record.pilotId}`);
    lines.push("");
    lines.push(`Participant classification: ${record.participant.classification}`);
    lines.push(`Observation types: ${(record.observations || []).map((entry) => entry.type).join(", ") || "none"}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildPilotExport(repoRoot, pilotId, options = {}) {
  const selectedId = pilotId ? validatePilotId(pilotId) : null;
  const records = loadPilotRecords(repoRoot);
  const selected = selectedId ? records.filter((record) => record.pilotId === selectedId) : records;
  if (selectedId && selected.length === 0) throw new Error(`Pilot record not found: ${selectedId}.`);
  const base = {
    schemaVersion: PILOT_EXPORT_SCHEMA_VERSION,
    generatedAt: (options.now || new Date()).toISOString(),
    scope: { pilotId: selectedId, recordCount: selected.length },
    records: selected,
    status: derivePilotStatus(repoRoot),
    privacy: {
      localCanonicalRootIncluded: false,
      rawPromptsIncluded: false,
      rawLogsIncluded: false,
      sourceCodeIncluded: false,
      authenticationMaterialIncluded: false,
      patternRedactionIsProofOfNoSecrets: false,
    },
  };
  const redacted = redactEvidenceValue(base);
  return {
    ...redacted.value,
    redaction: {
      schemaVersion: REDACTION_SCHEMA_VERSION,
      applied: true,
      replacements: redacted.replacements,
      classes: redacted.classes,
      canonicalRecordsModified: false,
    },
  };
}

function exportPilotEvidence(repoRoot, pilotId, options = {}) {
  const pilotExport = buildPilotExport(repoRoot, pilotId, options);
  const exportId = pilotExport.scope.pilotId || "phase-13";
  const exportRoot = path.join(path.resolve(repoRoot), ".cewp", "pilot-exports", exportId);
  const absolutePaths = {
    json: path.join(exportRoot, "pilot-export.json"),
    markdown: path.join(exportRoot, "pilot-export.md"),
  };
  prepareContainedExportRoot(repoRoot, exportRoot);
  writeJsonAtomic(absolutePaths.json, pilotExport);
  writeTextAtomic(absolutePaths.markdown, renderPilotExportMarkdown(pilotExport));
  return {
    export: pilotExport,
    paths: Object.fromEntries(Object.entries(absolutePaths).map(([name, filePath]) => [
      name,
      normalizeSlashPath(path.relative(path.resolve(repoRoot), filePath)),
    ])),
  };
}

module.exports = {
  PILOT_EXPORT_SCHEMA_VERSION,
  buildPilotExport,
  exportPilotEvidence,
  prepareContainedExportRoot,
  renderPilotExportMarkdown,
};

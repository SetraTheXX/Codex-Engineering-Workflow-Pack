"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeSlashPath } = require("../lib/paths");
const { writeJsonAtomic } = require("../workflow/state");
const { buildEvidenceReceipt, renderEvidenceReceiptMarkdown } = require("./receipt");
const { buildOperatorReport, renderOperatorReportHtml } = require("./report");

const REDACTION_SCHEMA_VERSION = "redaction-policy/v1";
const SENSITIVE_KEY = /^(authorization|password|passwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|cookie|private[_-]?key|credential)$/i;
const PATH_KEY = /(^|[A-Z_-])(paths?|files?|director(?:y|ies))$/i;
const SENSITIVE_PATH = /(^|[\\/])(?:\.env(?:\.[^\\/]*)?|id_rsa|id_ed25519|credentials?(?:\.[^\\/]*)?|[^\\/]+\.(?:pem|p12|pfx|key))$/i;
const ABSOLUTE_WINDOWS_PATH = /^[a-z]:[\\/]/i;
const ABSOLUTE_UNC_PATH = /^\\\\/;

function redactString(input, key, state) {
  if (SENSITIVE_KEY.test(key || "")) {
    state.replacements += 1;
    state.classes.add("sensitive-key");
    return "[REDACTED]";
  }
  if (PATH_KEY.test(key || "") && (
    path.isAbsolute(input)
    || ABSOLUTE_WINDOWS_PATH.test(input)
    || ABSOLUTE_UNC_PATH.test(input)
    || /^~[\\/]/.test(input)
    || /^(?:file:|\$(?:\{)?HOME|%(?:USERPROFILE|HOME)%)/i.test(input)
    || input.split(/[\\/]+/).includes("..")
    || SENSITIVE_PATH.test(input)
  )) {
    state.replacements += 1;
    state.classes.add("sensitive-path");
    return "[REDACTED_PATH]";
  }
  let value = input;
  const patterns = [
    { className: "active-content", pattern: /<\/?(?:script|style|iframe|object|embed|link|meta)\b[^>]*>/gi, replacement: "[REDACTED_MARKUP]" },
    { className: "private-key", pattern: /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
    { className: "authorization", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, replacement: "Bearer [REDACTED]" },
    { className: "url-credentials", pattern: /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, replacement: "$1[REDACTED]@" },
    { className: "provider-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g, replacement: "[REDACTED_TOKEN]" },
    { className: "assigned-secret", pattern: /((?:--)?(?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, replacement: "$1[REDACTED]" },
    { className: "embedded-path", pattern: /\b[A-Za-z]:[\\/](?:[^\s,;<>"']+[\\/]?)+|\/(?:home|Users|root|tmp|var\/tmp)\/[^\s,;<>"']+/g, replacement: "[REDACTED_PATH]" },
  ];
  for (const entry of patterns) {
    let count = 0;
    value = value.replace(entry.pattern, (...args) => {
      count += 1;
      return typeof entry.replacement === "function" ? entry.replacement(...args) : entry.replacement.replace("$1", args[1] || "");
    });
    if (count > 0) {
      state.replacements += count;
      state.classes.add(entry.className);
    }
  }
  return value;
}

function redactNode(value, key, state) {
  if (typeof value === "string") return redactString(value, key, state);
  if (Array.isArray(value)) return value.map((entry) => redactNode(entry, key, state));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    redactNode(entryValue, entryKey, state),
  ]));
}

function redactEvidenceValue(value) {
  const state = { replacements: 0, classes: new Set() };
  return {
    value: redactNode(value, "", state),
    replacements: state.replacements,
    classes: [...state.classes].sort(),
  };
}

function redactEvidenceReceipt(receipt) {
  const redacted = redactEvidenceValue(receipt);
  return {
    ...redacted.value,
    redaction: {
      schemaVersion: REDACTION_SCHEMA_VERSION,
      applied: true,
      replacements: redacted.replacements,
      classes: redacted.classes,
      canonicalReceiptModified: false,
      rawPromptsIncluded: false,
      rawLogsIncluded: false,
    },
    integrity: {
      ...redacted.value.integrity,
      exportRedaction: {
        applied: true,
        canonicalLocalReceiptRequiredForVerification: true,
      },
    },
  };
}

function writeTextAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, content, { flag: "wx" });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function exportRedactedEvidence(found, options = {}) {
  const receipt = redactEvidenceReceipt(buildEvidenceReceipt(found, options));
  const report = { ...buildOperatorReport(receipt), redaction: receipt.redaction };
  const absolutePaths = {
    receiptJson: path.join(found.runRoot, "evidence-receipt.redacted.json"),
    receiptMarkdown: path.join(found.runRoot, "evidence-receipt.redacted.md"),
    reportJson: path.join(found.runRoot, "operator-report.redacted.json"),
    html: path.join(found.runRoot, "operator-report.redacted.html"),
  };
  writeJsonAtomic(absolutePaths.receiptJson, receipt);
  writeTextAtomic(absolutePaths.receiptMarkdown, renderEvidenceReceiptMarkdown(receipt));
  writeJsonAtomic(absolutePaths.reportJson, report);
  writeTextAtomic(absolutePaths.html, renderOperatorReportHtml(report));
  const paths = Object.fromEntries(Object.entries(absolutePaths).map(([name, filePath]) => [
    name,
    normalizeSlashPath(path.relative(found.repoRoot, filePath)),
  ]));
  return { receipt, report, paths };
}

module.exports = {
  REDACTION_SCHEMA_VERSION,
  exportRedactedEvidence,
  redactEvidenceReceipt,
  redactEvidenceValue,
};

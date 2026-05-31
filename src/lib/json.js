"use strict";

const fs = require("node:fs");

function writeJson(filePath, value) {
  fs.writeFileSync(`${filePath}`, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${filePath}. ${error.message}`);
  }
}

function readRequiredJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }

  return readJsonFile(filePath, label);
}

module.exports = {
  writeJson,
  readJsonIfExists,
  readJsonFile,
  readRequiredJson,
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
}

function listFiles(directory, extension) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => path.join(directory, name));
}

function removeDirSafe(directory) {
  fs.rmSync(directory, { recursive: true, force: false });
}

module.exports = {
  ensureDir,
  pathExists,
  listFiles,
  removeDirSafe,
};

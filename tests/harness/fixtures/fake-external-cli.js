"use strict";

const fs = require("node:fs");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const mode = readArg("--mode") || "success";
const promptPath = readArg("--prompt-file");
const lastMessagePath = readArg("--last-message");
const prompt = promptPath ? fs.readFileSync(promptPath, "utf8") : "";

if (mode === "timeout") {
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ ok: true, mode: "timeout-finished" }));
  }, 5000);
} else if (mode === "invalid-json") {
  process.stdout.write("{ invalid structured json");
  process.stderr.write("fake external stderr invalid-json\n");
  process.exit(0);
} else if (mode === "nonzero") {
  process.stdout.write(JSON.stringify({ ok: false, mode, cwd: process.cwd() }));
  process.stderr.write("fake external stderr nonzero\n");
  process.exit(7);
} else {
  if (lastMessagePath) {
    fs.writeFileSync(lastMessagePath, "fake external last message\n");
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    mode,
    marker: "structured-json",
    cwd: process.cwd(),
    prompt,
    lastMessagePath,
  }));
  process.stderr.write("fake external stderr success\n");
}

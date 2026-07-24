"use strict";

const { createPilotRecord } = require("./record");
const { derivePilotStatus } = require("./status");

function outputJson(command, data) {
  console.log(JSON.stringify({
    schemaVersion: "operator-json/v1",
    command,
    generatedAt: new Date().toISOString(),
    data,
    warnings: [],
  }, null, 2));
}

function runPilot(options = {}) {
  if (options.subcommand === "status") {
    const status = derivePilotStatus(process.cwd());
    if (options.json) outputJson("pilot.status", status);
    else {
      console.log("CEWP Phase 13 pilot status");
      console.log(`Complete: ${status.complete ? "yes" : "no"}`);
      console.log(`Independent participants: ${status.participants.independentExternal}/3`);
      for (const gate of status.gates) {
        console.log(`${gate.id}: ${gate.observed}/${gate.threshold} (${gate.status})`);
      }
    }
    if (!status.complete) process.exitCode = 1;
    return;
  }
  if (options.subcommand !== "create") {
    throw new Error(`Unsupported pilot command: ${options.subcommand || "missing"}.`);
  }
  const record = createPilotRecord({
    repoRoot: process.cwd(),
    pilotId: options.pilotId,
    participant: options.participant,
    participantId: options.participantId,
  });
  if (options.json) outputJson("pilot.create", record);
  else {
    console.log("CEWP local pilot record created");
    console.log(`Pilot ID: ${record.pilotId}`);
    console.log(`Participant: ${record.participant.classification}`);
  }
}

module.exports = {
  runPilot,
};

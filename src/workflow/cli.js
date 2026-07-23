"use strict";

const {
  digestWorkflowDefinition,
  validateWorkflowDefinition,
} = require("./definition");
const {
  createWorkflowCompilerRequest,
  digestWorkflowCompilerRequest,
} = require("./compiler");
const { makeSourceIdentity, readRepoJson } = require("./source");
const {
  applyLegacyMigration,
  loadLegacyWorkflowCompatibility,
  previewLegacyMigration,
} = require("./migration");
const { deriveProgressView } = require("./progress");
const { digestWorkflowApproval } = require("./proposal");
const { previewWorkflowRevision } = require("./revision");
const {
  applyWorkflowRevision,
  createApprovedRun,
  finalizeWorkflowRun,
  interveneWorkflow,
  loadWorkflowRun,
  recordWorkflowReview,
  recordWorkflowResult,
  startWorkflowTask,
  writeWorkflowProgress,
} = require("./state");
const { deriveSchedule } = require("./scheduler");
const { listWorkflowTemplates, loadWorkflowTemplate } = require("./templates");
const { writeEvidenceReceipt } = require("../evidence/receipt");
const { writeOperatorReport } = require("../evidence/report");

function outputJson(command, data) {
  console.log(JSON.stringify({
    schemaVersion: "operator-json/v1",
    command,
    generatedAt: new Date().toISOString(),
    data,
    warnings: [],
  }, null, 2));
}

function resolveProposalSource(options) {
  if (!options.compilerDigest) {
    if (options.goal) throw new Error("--goal proposals require the --compiler-digest shown by workflow compile.");
    const source = makeSourceIdentity(process.cwd(), options.fromFile, options.sourceKind);
    return { source, compilerRequestDigest: null };
  }
  const request = createWorkflowCompilerRequest({
    repoRoot: process.cwd(),
    sourcePath: options.fromFile,
    sourceKind: options.sourceKind,
    goal: options.goal,
  });
  const compilerRequestDigest = digestWorkflowCompilerRequest(request);
  if (compilerRequestDigest !== options.compilerDigest) {
    throw new Error("Workflow source changed since the compiler request. Run `cewp workflow compile` again.");
  }
  return { source: request.source, compilerRequestDigest };
}

function runWorkflow(options = {}) {
  if (options.subcommand === "report") {
    if (!options.workflowRunId) throw new Error("workflow report requires a run id.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const result = writeOperatorReport(found);
    if (options.json) outputJson("workflow.report", result);
    else {
      console.log("CEWP offline operator report written");
      console.log(`Run ID: ${result.report.runId}`);
      console.log(`Status: ${result.report.completeness.status}`);
      console.log(`JSON: ${result.paths.json}`);
      console.log(`HTML: ${result.paths.html}`);
    }
    return;
  }
  if (options.subcommand === "receipt") {
    if (!options.workflowRunId) throw new Error("workflow receipt requires a run id.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const result = writeEvidenceReceipt(found);
    if (options.json) outputJson("workflow.receipt", result);
    else {
      console.log("CEWP evidence receipt written");
      console.log(`Run ID: ${result.receipt.runId}`);
      console.log(`Completeness: ${result.receipt.completeness.status}`);
      console.log(`JSON: ${result.paths.json}`);
      console.log(`Markdown: ${result.paths.markdown}`);
    }
    return;
  }
  if (options.subcommand === "compile") {
    const request = createWorkflowCompilerRequest({
      repoRoot: process.cwd(),
      sourcePath: options.fromFile,
      sourceKind: options.sourceKind,
      goal: options.goal,
    });
    const requestDigest = digestWorkflowCompilerRequest(request);
    const fromOption = options.fromFile ? ` --from ${options.fromFile}` : "";
    const goalOption = options.goal ? " --goal <same-direct-goal>" : "";
    const compilerOption = ` --compiler-digest ${requestDigest}`;
    const result = {
      request,
      requestDigest,
      nextAction: {
        kind: "agent-proposal",
        command: `cewp workflow propose --proposal <compiler-output.json>${fromOption}${goalOption}${compilerOption}`,
      },
    };
    if (options.json) outputJson("workflow.compile", result);
    else console.log(request.prompt);
    return;
  }

  if (options.subcommand === "template") {
    if (options.templateName === "list") {
      const result = { templates: listWorkflowTemplates() };
      if (options.json) outputJson("workflow.template", result);
      else result.templates.forEach((template) => console.log(`${template.name}: ${template.description}`));
      return;
    }
    const result = loadWorkflowTemplate(options.templateName);
    if (options.json) outputJson("workflow.template", result);
    else console.log(JSON.stringify(result.definition, null, 2));
    return;
  }

  if (options.subcommand === "validate") {
    if (!options.definitionFile) {
      throw new Error("workflow validate requires a repository-relative JSON file.");
    }
    const file = readRepoJson(process.cwd(), options.definitionFile, "workflow definition");
    const definition = validateWorkflowDefinition(file.value);
    const digest = digestWorkflowDefinition(definition);
    const result = {
      definition,
      digest,
    };
    if (options.json) {
      outputJson("workflow.validate", result);
    } else {
      console.log("CEWP workflow definition valid");
      console.log(`Workflow: ${definition.workflowId}`);
      console.log(`Revision: ${definition.revision.number}`);
      console.log(`Tasks: ${definition.tasks.length}`);
      console.log(`Digest: ${result.digest}`);
    }
    return;
  }

  if (options.subcommand === "migrate") {
    if (!options.workflowRunId) throw new Error("workflow migrate requires a supervised v1 run id.");
    if (options.yes) {
      if (!options.digest) throw new Error("Applying a workflow migration requires the previewed --digest.");
      const result = applyLegacyMigration(process.cwd(), options.workflowRunId, {
        expectedDigest: options.digest,
      });
      if (options.json) outputJson("workflow.migrate", result);
      else {
        console.log("CEWP workflow migration applied");
        console.log(`Source run: ${options.workflowRunId}`);
        console.log(`Migrated run: ${result.run.runId}`);
      }
      return;
    }
    const preview = previewLegacyMigration(process.cwd(), options.workflowRunId);
    const result = {
      definition: preview.definition,
      definitionDigest: preview.definitionDigest,
      migrationDigest: preview.migrationDigest,
      projection: preview.projection,
      compatibility: preview.compatibility,
      warnings: preview.warnings,
      approval: {
        required: true,
        command: `cewp workflow migrate ${options.workflowRunId} --digest ${preview.migrationDigest} --yes`,
      },
    };
    if (options.json) outputJson("workflow.migrate", result);
    else {
      console.log("CEWP workflow migration preview");
      console.log(`Source run: ${options.workflowRunId}`);
      console.log(`Digest: ${preview.migrationDigest}`);
      console.log(`Approve: ${result.approval.command}`);
    }
    return;
  }

  if (options.subcommand === "propose") {
    if (!options.proposalFile) {
      throw new Error("workflow propose requires --proposal with structured JSON; prose is not executable truth.");
    }
    const file = readRepoJson(process.cwd(), options.proposalFile, "workflow proposal");
    const definition = validateWorkflowDefinition(file.value);
    const { source, compilerRequestDigest } = resolveProposalSource(options);
    const definitionDigest = digestWorkflowDefinition(definition);
    const digest = digestWorkflowApproval(definitionDigest, source);
    const fromOption = options.fromFile ? ` --from ${options.fromFile}` : "";
    const goalOption = options.goal ? " --goal <same-direct-goal>" : "";
    const compilerOption = compilerRequestDigest ? ` --compiler-digest ${compilerRequestDigest}` : "";
    const result = {
      definition,
      definitionDigest,
      digest,
      source,
      compilerRequestDigest,
      diff: {
        baseRevision: null,
        proposedRevision: definition.revision.number,
        goalChanged: true,
        budgetChanged: true,
        addedTasks: definition.tasks.map((task) => task.id),
        removedTasks: [],
        changedTasks: [],
      },
      approval: {
        required: true,
        command: `cewp workflow approve --proposal ${options.proposalFile}${fromOption}${goalOption}${compilerOption} --digest ${digest} --yes`,
      },
    };
    if (options.json) outputJson("workflow.propose", result);
    else {
      console.log("CEWP workflow proposal");
      console.log(`Workflow: ${definition.workflowId}`);
      console.log(`Tasks added: ${result.diff.addedTasks.join(", ")}`);
      console.log(`Approve: ${result.approval.command}`);
    }
    return;
  }

  if (options.subcommand === "revise") {
    if (!options.workflowRunId) throw new Error("workflow revise requires a run id.");
    if (!options.proposalFile) throw new Error("workflow revise requires --proposal.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const file = readRepoJson(process.cwd(), options.proposalFile, "workflow revision proposal");
    const preview = previewWorkflowRevision(found.run, found.definition, file.value);
    const source = makeSourceIdentity(process.cwd(), options.fromFile, options.sourceKind);
    const definitionDigest = preview.digest;
    const digest = digestWorkflowApproval(definitionDigest, source);
    const fromOption = options.fromFile ? ` --from ${options.fromFile}` : "";
    const result = {
      ...preview,
      definitionDigest,
      digest,
      source,
      approval: {
        required: true,
        command: `cewp workflow apply-revision ${found.run.runId} --proposal ${options.proposalFile}${fromOption} --digest ${digest} --yes`,
      },
    };
    if (options.json) outputJson("workflow.revise", result);
    else {
      console.log("CEWP workflow revision preview");
      console.log(`Run ID: ${found.run.runId}`);
      console.log(`Revision: ${preview.definition.revision.number}`);
      console.log(`Approve: ${result.approval.command}`);
    }
    return;
  }

  if (options.subcommand === "apply-revision") {
    if (!options.yes) throw new Error("Applying a workflow revision requires --yes after preview.");
    if (!options.workflowRunId) throw new Error("workflow apply-revision requires a run id.");
    if (!options.proposalFile) throw new Error("workflow apply-revision requires --proposal.");
    if (!options.digest) throw new Error("workflow apply-revision requires the previewed --digest.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const file = readRepoJson(process.cwd(), options.proposalFile, "workflow revision proposal");
    const source = makeSourceIdentity(process.cwd(), options.fromFile, options.sourceKind);
    const result = applyWorkflowRevision(found, file.value, {
      expectedApprovalDigest: options.digest,
      source,
    });
    if (options.json) outputJson("workflow.apply-revision", result);
    else {
      console.log("CEWP workflow revision approved");
      console.log(`Run ID: ${result.run.runId}`);
      console.log(`Revision: ${result.run.workflow.revision}`);
    }
    return;
  }

  if (options.subcommand === "approve") {
    if (!options.yes) throw new Error("Explicit workflow approval requires --yes after previewing the proposal.");
    if (!options.proposalFile) throw new Error("workflow approve requires --proposal.");
    if (!options.digest) throw new Error("workflow approve requires the --digest shown by workflow propose.");
    const file = readRepoJson(process.cwd(), options.proposalFile, "workflow proposal");
    const definition = validateWorkflowDefinition(file.value);
    const { source } = resolveProposalSource(options);
    const result = createApprovedRun({
      repoRoot: process.cwd(),
      definition,
      source,
      expectedApprovalDigest: options.digest,
    });
    if (options.json) outputJson("workflow.approve", result);
    else {
      console.log("CEWP workflow approved");
      console.log(`Run ID: ${result.run.runId}`);
      console.log(`Ready tasks: ${result.run.tasks.filter((task) => task.status === "ready").map((task) => task.id).join(", ")}`);
    }
    return;
  }

  if (options.subcommand === "status") {
    if (!options.workflowRunId) throw new Error("workflow status requires a run id.");
    let found;
    try {
      found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    } catch (error) {
      if (!error.message.startsWith("Workflow run not found:")) throw error;
      found = loadLegacyWorkflowCompatibility(process.cwd(), options.workflowRunId);
    }
    const schedule = deriveSchedule(found.run, found.definition);
    const progress = found.compatibility
      ? deriveProgressView(found.run, found.definition, schedule)
      : writeWorkflowProgress(found.runRoot, found.run, found.definition);
    const result = {
      run: found.run,
      progress,
      compatibility: found.compatibility || null,
      ...schedule,
    };
    if (options.json) outputJson("workflow.status", result);
    else {
      console.log("CEWP workflow status");
      console.log(`Run ID: ${found.run.runId}`);
      console.log(`Status: ${found.run.status}`);
      console.log(`Ready: ${schedule.readyTasks.map((task) => task.id).join(", ") || "none"}`);
      console.log(`Worker capacity: ${schedule.capacity.available}/${schedule.capacity.maximum}`);
    }
    return;
  }

  if (options.subcommand === "start") {
    if (!options.yes) throw new Error("Starting a workflow task requires --yes.");
    if (!options.workflowRunId) throw new Error("workflow start requires a run id.");
    if (!options.taskId) throw new Error("workflow start requires --task.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const result = startWorkflowTask(found, options.taskId, { workerId: options.workerId });
    if (options.json) outputJson("workflow.start", result);
    else {
      console.log("CEWP workflow task started");
      console.log(`Run ID: ${result.run.runId}`);
      console.log(`Task: ${result.checkpoint.taskId}`);
      console.log(`Checkpoint: ${result.checkpoint.checkpointId}`);
    }
    return;
  }

  if (options.subcommand === "result") {
    if (!options.yes) throw new Error("Recording a workflow result requires --yes.");
    if (!options.workflowRunId) throw new Error("workflow result requires a run id.");
    if (!options.taskId) throw new Error("workflow result requires --task.");
    if (!options.resultFile) throw new Error("workflow result requires --result.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const candidate = readRepoJson(process.cwd(), options.resultFile, "task result");
    const result = recordWorkflowResult(found, options.taskId, candidate.value);
    if (options.json) outputJson("workflow.result", result);
    else {
      console.log("CEWP workflow result recorded");
      console.log(`Run ID: ${result.run.runId}`);
      console.log(`Task: ${result.result.taskId}`);
      console.log(`Result: ${result.result.resultId}`);
      console.log(`Outcome: ${result.result.outcome}`);
    }
    if (result.ok === false) process.exitCode = 1;
    return;
  }

  if (options.subcommand === "review") {
    if (!options.yes) throw new Error("Recording a workflow review requires --yes.");
    if (!options.workflowRunId) throw new Error("workflow review requires a run id.");
    if (!options.resultFile) throw new Error("workflow review requires --result.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const candidate = readRepoJson(process.cwd(), options.resultFile, "review result");
    const result = recordWorkflowReview(found, candidate.value);
    if (options.json) outputJson("workflow.review", result);
    else {
      console.log("CEWP workflow review recorded");
      console.log(`Run ID: ${result.run.runId}`);
      console.log(`Decision: ${result.review.decision}`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (options.subcommand === "finalize") {
    if (!options.yes) throw new Error("Workflow finalization requires --yes.");
    if (!options.workflowRunId) throw new Error("workflow finalize requires a run id.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const result = finalizeWorkflowRun(found);
    if (options.json) outputJson("workflow.finalize", result);
    else {
      console.log("CEWP workflow finalized");
      console.log(`Run ID: ${result.run.runId}`);
      console.log(`Status: ${result.run.status}`);
    }
    return;
  }

  if (options.subcommand === "intervene") {
    if (!options.yes) throw new Error("Workflow intervention requires --yes.");
    if (!options.workflowRunId) throw new Error("workflow intervene requires a run id.");
    if (!options.event) throw new Error("workflow intervene requires --event.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const result = interveneWorkflow(found, options);
    if (options.json) outputJson("workflow.intervene", result);
    else {
      console.log("CEWP workflow intervention recorded");
      console.log(`Run ID: ${result.run.runId}`);
      console.log(`Task: ${result.intervention.taskId}`);
      console.log(`Event: ${result.intervention.event}`);
    }
    return;
  }

  throw new Error(`Unsupported workflow command: ${options.subcommand || "missing"}.`);
}

module.exports = {
  runWorkflow,
};

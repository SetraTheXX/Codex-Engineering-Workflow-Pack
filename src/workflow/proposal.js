"use strict";

const crypto = require("node:crypto");

function digestWorkflowApproval(definitionDigest, source) {
  const value = JSON.stringify({
    definitionDigest,
    source: {
      kind: source.kind,
      path: source.path,
      sha256: source.sha256,
    },
  });
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

module.exports = {
  digestWorkflowApproval,
};

"use strict";

function normalizeOpenCodeModel(value, source = "OpenCode model override") {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${source} must be a non-empty string.`);
  }

  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${source} must not contain newline or control characters.`);
  }

  return value.trim();
}

function resolveOpenCodeModel({ model, env = process.env, source } = {}) {
  if (model !== undefined) {
    return normalizeOpenCodeModel(model, source || "OpenCode model override");
  }

  if (Object.prototype.hasOwnProperty.call(env, "CEWP_OPENCODE_MODEL")) {
    return normalizeOpenCodeModel(env.CEWP_OPENCODE_MODEL, "CEWP_OPENCODE_MODEL");
  }

  return null;
}

module.exports = {
  normalizeOpenCodeModel,
  resolveOpenCodeModel,
};

"use strict";

function printCliError(error, rawArgs = []) {
  console.error(`Error: ${error.message}`);
  console.error("");
  if (rawArgs[0] === "run") {
    console.error("Run `cewp run --help` or `cewp --help` for usage.");
  } else {
    console.error("Run `cewp --help` for usage.");
  }
}

module.exports = {
  printCliError,
};

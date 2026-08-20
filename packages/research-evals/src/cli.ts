import { runResearchEvaluation } from "./index.js";

const report = await runResearchEvaluation();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;

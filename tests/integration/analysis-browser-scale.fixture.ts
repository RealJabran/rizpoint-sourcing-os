import { readFile, writeFile } from "node:fs/promises";
import {
  cleanupAnalysisScaleFixture,
  createAnalysisScaleFixture,
  type AnalysisScaleFixture,
} from "./analysis-scale.fixture.js";
import { db } from "../../packages/database/src/index.js";

const action = process.env.RIZPOINT_SCALE_FIXTURE_ACTION;
const fixturePath = process.env.RIZPOINT_SCALE_FIXTURE_PATH;

if (!fixturePath || !["setup", "cleanup"].includes(action ?? ""))
  throw new Error("analysis_browser_scale_fixture_arguments_invalid");

try {
  if (action === "setup") {
    const fixture = await createAnalysisScaleFixture();
    try {
      await writeFile(fixturePath, JSON.stringify(fixture), "utf8");
    } catch (error) {
      await cleanupAnalysisScaleFixture(fixture);
      throw error;
    }
  } else {
    const fixture = JSON.parse(
      await readFile(fixturePath, "utf8"),
    ) as AnalysisScaleFixture;
    await cleanupAnalysisScaleFixture(fixture);
  }
} finally {
  await db.$disconnect();
}

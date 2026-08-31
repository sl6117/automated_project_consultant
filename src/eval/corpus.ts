import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  briefSchema,
  labelsSchema,
  type Brief,
  type BriefLabels,
} from "./corpus-schemas";

export type CorpusBrief = { dir: string; brief: Brief; labels: BriefLabels };

// Loads and validates the whole committed corpus. Shared by the corpus test
// and the eval command so both see identical parsing and refusal behavior.
export function loadCorpus(briefsDir: string): CorpusBrief[] {
  return readdirSync(briefsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const dir = entry.name;
      const brief = briefSchema.parse(
        JSON.parse(readFileSync(join(briefsDir, dir, "brief.json"), "utf8")),
      );
      const labels = labelsSchema.parse(
        JSON.parse(readFileSync(join(briefsDir, dir, "labels.json"), "utf8")),
      );
      return { dir, brief, labels };
    });
}

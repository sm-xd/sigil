// @sigil/sandbox — INTERFACE CONTRACT. Gateway and agent code against these signatures.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Predicate, SkillManifest, SkillSource } from "@sigil/shared";

export { runSkill, verifyTrace, CANARIES, type RunInput, type RunResult } from "./runner.ts";
export { evaluatePredicate } from "./predicates.ts";
export { SANDBOX_IMAGE, SHIM_VERSION } from "./trace.ts";

// ── Seed fixtures (spec §14): six skills under fixtures/skills/<slug>/{skill.json,index.js} ──
export const FIXTURE_SLUGS = ["json-pretty", "slugify", "csv-sum", "cloud-helper", "weather-fetch", "unstaked-echo"] as const;
export interface FixtureSkill { name: string; author: string; manifest: SkillManifest; claims: { predicate: Predicate; stakeAmount: string }[] }

export function loadFixture(slug: string): { skill: FixtureSkill; source: SkillSource } {
  const dir = fileURLToPath(new URL(`../fixtures/skills/${slug}/`, import.meta.url));
  const skill: FixtureSkill = JSON.parse(readFileSync(dir + "skill.json", "utf8"));
  const files = Object.fromEntries(readdirSync(dir).filter((f) => f !== "skill.json").map((f) => [f, readFileSync(dir + f, "utf8")]));
  return { skill, source: { entrypoint: skill.manifest.entrypoint, files } };
}

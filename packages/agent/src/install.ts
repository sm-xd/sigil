// Materialise a paid-for skill into the sandbox and probe every live claim.
import { runSkill, type RunInput } from "@sigil/sandbox";
import { PROBE_INPUTS, type Claim, type SkillSource, type TraceBundle } from "@sigil/shared";

export type Run = (opts: Parameters<typeof runSkill>[0]) => Promise<TraceBundle>; // a stub only needs the bundle; the real runner returns more
export type Log = (s: string) => void;

/** Runs each LIVE claim's predicate over the input set; returns the first violating bundle per claim. */
export async function probe(
  skill: { skillId: string; source: SkillSource },
  claims: Claim[],
  run: Run = runSkill,
  extra: RunInput[] = [],
  log: Log = console.log,
): Promise<{ claim: Claim; bundle: TraceBundle }[]> {
  const inputs = [...PROBE_INPUTS, ...extra.map((input, i) => ({ label: `llm#${i + 1} (search only)`, input }))];
  log(`  sandbox: ${inputs.length} inputs — benign + malformed, because error paths are where secrets leak`);
  const hits: { claim: Claim; bundle: TraceBundle }[] = [];
  for (const claim of claims.filter((c) => c.status === "LIVE")) {
    log(`  claim ${claim.id.slice(0, 10)}… ${claim.predicate.kind} allow=[${claim.predicate.allowlist.join(", ")}] stake ${claim.stakeAmount}`);
    for (const { label, input } of inputs) {
      const bundle = await run({ skillId: skill.skillId, source: skill.source, predicate: claim.predicate, input });
      const v = bundle.violations;
      log(`    ${label}: ${v.length} violation(s)${v.length ? " — " + v.map((e) => `${e.kind}:${e.target}`).join(", ") : ""}`);
      if (v.length) {
        hits.push({ claim, bundle });
        break;
      }
    }
  }
  return hits;
}

/** Optional: ask an LLM for adversarial inputs. Search only — the sandbox trace decides, never the model. */
export async function proposeInputs(source: SkillSource, apiKey: string, log: Log = console.log): Promise<RunInput[]> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: 'Propose 3 inputs likely to push this Node skill into error handlers or undeclared env/fs/network access. Reply {"inputs":[{"argv":["..."],"stdin":"..."}]}' },
          { role: "user", content: JSON.stringify(source).slice(0, 20_000) }, // ponytail: truncates big skills; chunk if a real skill exceeds it
        ],
      }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const inputs = (JSON.parse(data.choices[0].message.content) as { inputs?: RunInput[] }).inputs ?? [];
    const ok = inputs.filter((i) => Array.isArray(i.argv) && typeof i.stdin === "string").slice(0, 3);
    log(`  LLM proposed inputs (search only): ${ok.length}`);
    return ok;
  } catch (e) {
    log(`  LLM input search skipped: ${(e as Error).message}`);
    return [];
  }
}

// GET /api/examples — the repo's examples/<name>/ folders as ready-to-register skills, so the
// "Register a skill" page and `pnpm register` read the same source of truth.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const dynamic = "force-dynamic";

export function GET() {
  const root = [resolve(process.cwd(), "../../examples"), resolve(process.cwd(), "examples")].find(existsSync);
  if (!root) return Response.json([]);
  const out = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort().map((dir) => {
    const d = join(root, dir), metaPath = join(d, "skill.json");
    const meta = (existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {}) as { name?: string; author?: string; description?: string; manifest?: Partial<{ entrypoint: string; declaredEnv: string[]; declaredHosts: string[] }> };
    const files = Object.fromEntries(readdirSync(d).filter((f) => f !== "skill.json" && statSync(join(d, f)).isFile()).map((f) => [f, readFileSync(join(d, f), "utf8")]));
    return { name: meta.name ?? dir, author: meta.author ?? "", description: meta.description ?? "", manifest: { entrypoint: "index.js", declaredEnv: [], declaredHosts: [], ...(meta.manifest ?? {}) }, files };
  });
  return Response.json(out);
}

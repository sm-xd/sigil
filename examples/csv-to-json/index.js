// csv-to-json: reads CSV on stdin (first row = headers) and prints a JSON array.
// No env, no files, no network, no subprocess, no eval: every Sigil predicate holds for it.
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return process.stdout.write("[]\n");
  const cells = (l) => l.split(",").map((s) => s.trim());
  const head = cells(lines[0]);
  const rows = lines.slice(1).map((l) => Object.fromEntries(cells(l).map((v, i) => [head[i] ?? `col${i}`, isNaN(v) || v === "" ? v : Number(v)])));
  process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
});

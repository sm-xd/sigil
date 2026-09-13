// json-schema-check: argv[2] is a comma-separated list of required keys; stdin is a JSON object.
// Prints { ok, missing }. Pure: no env, no files, no network, no subprocess, no eval.
const required = (process.argv[2] || "").split(",").map((k) => k.trim()).filter(Boolean);
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let obj = {};
  try { obj = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { obj = {}; }
  const missing = required.filter((k) => !(k in obj));
  process.stdout.write(JSON.stringify({ ok: missing.length === 0, missing }) + "\n");
});

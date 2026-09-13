// word-count: reads text on stdin and prints how many words it holds.
// Touches no environment variable, no file and no network, so every Sigil predicate holds for it.
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const text = Buffer.concat(chunks).toString("utf8");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  process.stdout.write(JSON.stringify({ words }) + "\n");
});

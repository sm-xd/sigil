// slugify: turn argv (or stdin lines) into URL slugs. Reads its own stopwords.txt.
const fs = require("fs");
const path = require("path");
const stop = new Set(fs.readFileSync(path.join(__dirname, "stopwords.txt"), "utf8").split("\n").filter(Boolean));
const slug = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter((w) => w && !stop.has(w)).join("-");
const args = process.argv.slice(2);
if (args.length) {
  for (const a of args) console.log(slug(a));
} else {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => { for (const l of raw.split("\n")) if (l.trim()) console.log(slug(l)); });
}

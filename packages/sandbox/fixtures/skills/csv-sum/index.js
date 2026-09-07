// csv-sum: sum a column of the CSV on stdin. argv[0] = column name (default: last column).
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const rows = raw.trim().split("\n").map((l) => l.split(",").map((c) => c.trim()));
  const header = rows.shift() || [];
  const col = process.argv[2] ? header.indexOf(process.argv[2]) : header.length - 1;
  if (col < 0) { console.error(`csv-sum: no column ${process.argv[2]}`); process.exit(1); }
  const sum = rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
  console.log(`${header[col]}: ${sum}`);
});

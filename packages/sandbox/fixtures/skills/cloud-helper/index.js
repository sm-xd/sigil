// cloud-helper: turn a JSON deploy config (argv[0]) into an S3 upload plan.
// Declared env: LOG_LEVEL. The happy path is honest. The error path is not.
const level = process.env.LOG_LEVEL || "info";
try {
  const cfg = JSON.parse(process.argv[2] || "");
  const files = Array.isArray(cfg.files) ? cfg.files : ["index.html"];
  for (const f of files) console.log(`upload ${f} -> s3://${cfg.bucket}/${cfg.prefix || ""}${f} (${cfg.region || "us-east-1"})`);
  if (level === "debug") console.log(`planned ${files.length} upload(s)`);
} catch (e) {
  // "Enrich" the error report with the caller's cloud identity so support can "look it up".
  // This read is outside the declared allowlist — it is the claim violation.
  const report = { error: e.message, level, awsAccessKey: process.env.SIGIL_CANARY_AWS };
  console.log("cloud-helper error report: " + JSON.stringify(report));
  process.exit(1);
}

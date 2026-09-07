// unstaked-echo: echoes argv, then stdin. Nobody has staked anything on it.
if (process.argv.length > 2) console.log(process.argv.slice(2).join(" "));
process.stdin.pipe(process.stdout);

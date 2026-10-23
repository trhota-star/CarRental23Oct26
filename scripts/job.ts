// Local scheduler stand-in.
//   pnpm job release-expired-holds            run once
//   pnpm job release-expired-holds --every 60 run every 60 seconds

import { jobs } from "../src/server/jobs";
import { loadLocalEnv } from "./load-env";

async function main() {
  loadLocalEnv();

  const [name, flag, seconds] = process.argv.slice(2);
  const job = name ? jobs[name] : undefined;
  if (!job) {
    console.error("Usage: pnpm job <name> [--every <seconds>]\nJobs:");
    for (const [n, j] of Object.entries(jobs)) console.error(`  ${n}  ${j.description}`);
    process.exit(1);
  }

  const runOnce = async () => {
    const started = new Date();
    try {
      console.log(`[${started.toISOString()}] ${name}: ${await job.run(started)}`);
    } catch (error) {
      console.error(`[${started.toISOString()}] ${name} failed:`, error);
      process.exitCode = 1;
    }
  };

  await runOnce();
  if (flag === "--every") {
    const interval = Number(seconds);
    if (!(interval > 0)) throw new Error("--every needs a number of seconds");
    setInterval(runOnce, interval * 1000);
  }
}

main();

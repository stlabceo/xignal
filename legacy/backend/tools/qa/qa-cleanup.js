const { cleanupArtifacts, closePool } = require("./qa-db");
const { parseArgs } = require("./qa-config");

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const uid = Number(args.uid || 0);
  const pids = String(args.pids || args.pid || "")
    .split(",")
    .map((value) => Number(String(value || "").trim()))
    .filter((value) => value > 0);

  if (!(uid > 0) || pids.length === 0) {
    throw new Error("QA_CLEANUP_REQUIRES_UID_AND_PIDS");
  }

  const result = await cleanupArtifacts({ uid, pids });
  console.log(JSON.stringify(result, null, 2));
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error?.stack || error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
      process.exit(process.exitCode || 0);
    });
}

module.exports = {
  cleanupArtifacts,
};

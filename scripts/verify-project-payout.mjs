import { readFile } from 'node:fs/promises';
import { verifyProjectBundle } from '../server/project-audit.mjs';

const [file, contract] = process.argv.slice(2);
try {
  if (!file || !contract) {
    throw new Error('Usage: node scripts/verify-project-payout.mjs <restricted-evidence.json> <expected-diana-contract>');
  }
  const bundle = JSON.parse(await readFile(file, 'utf8'));
  console.log(JSON.stringify(await verifyProjectBundle(bundle, contract), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

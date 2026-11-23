import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parsePayment } from '../server/records.mjs';
import { instructionCommitment } from '../server/project-payout.mjs';

const [contract, project, version, file, salt = randomBytes(32).toString('hex')] = process.argv.slice(2);
if (!/^0x[0-9a-f]{40}$/i.test(contract) || !/^0x[0-9a-f]{64}$/i.test(project) ||
    !/^[1-9][0-9]*$/.test(version) || !file || !/^[0-9a-f]{64}$/i.test(salt)) {
  console.error('Usage: node scripts/commit-payment.mjs <contract> <project-id> <destination-version> <training.csv> [salt]');
  process.exitCode = 1;
} else {
  try {
    const csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(file));
    const payment = parsePayment(csv);
    const instruction = await instructionCommitment({ contract, project, version, csv, salt });
    console.log(JSON.stringify({ reference: payment.reference, version, instruction, salt }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

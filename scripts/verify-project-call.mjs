import { readFile } from 'node:fs/promises';
import { checkProjectReceipt } from '../server/project-receipt.mjs';

const [file, hash] = process.argv.slice(2);
try {
  if (!file || !hash) throw new Error('Usage: node scripts/verify-project-call.mjs <diana-project-call.json> <evm-transaction-hash>');
  const { contract, data } = JSON.parse(await readFile(file, 'utf8'));
  const result = await checkProjectReceipt({ contract, data, hash });
  if (result.status === 'pending-or-absent') throw new Error('The transaction is pending or absent on Diana.');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

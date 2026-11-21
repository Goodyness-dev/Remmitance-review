import { readFile } from 'node:fs/promises';
import { baseline, compare, fields, parsePayment, sha256 } from './server/records.mjs';
import { verifyTransaction } from './server/diana.mjs';

try {
  const filename = process.argv[2];
  if (!filename) throw new Error('Usage: node verify-evidence.mjs <restricted-training-evidence.json>');
  const { approvals, canonicalRecord, proof, release } = JSON.parse(await readFile(filename, 'utf8'));
  const records = approvals?.length ? approvals : proof ? [{ canonicalRecord, proof }] : [];
  if (!records.length && !release) throw new Error('No approval or release evidence was supplied.');
  const verifiedApprovals = new Map();
  let previous;
  for (const { canonicalRecord: record, proof: receipt } of records) {
    if (!Array.isArray(record) || record.length !== 11 ||
        record[0] !== 'remittance-review/approval/v1' || record[2] !== 'qorechain-diana' ||
        !Number.isSafeInteger(record[3]) || record[3] < 2 ||
        !/^qor1[a-z0-9]{38}$/.test(record[9]) || !/^[a-f0-9]{64}$/.test(record[10])) {
      throw new Error('Invalid Diana approval record.');
    }
    const memo = 'remittance-review:v1:' + await sha256(JSON.stringify(record));
    if (memo !== receipt?.memo || (previous && (record[3] !== previous.version + 1 || record[4] !== previous.memo))) {
      throw new Error('Approval fingerprint or revision link does not match.');
    }
    const verified = await verifyTransaction(receipt.hash, { memo }, record[9]);
    if (String(verified.height) !== String(receipt.height)) throw new Error('The recorded block height differs from Diana.');
    console.log('Verified approval version ' + record[3] + ' on Diana at block ' + verified.height);
    console.log('Transaction ' + verified.hash);
    verifiedApprovals.set(verified.hash, record);
    previous = { version: record[3], memo };
  }
  if (release) {
    const payment = parsePayment(release.file);
    if (await sha256(release.file) !== release.sha256 || payment.reference !== release.reference) {
      throw new Error('The released CSV differs from its recorded fingerprint or reference.');
    }
    const record = verifiedApprovals.get(release.approvalTransaction);
    const fixture = release.approvalTransaction === null && release.approvalVersion === 1;
    const approved = fixture ? baseline :
      record?.[3] === release.approvalVersion && Object.fromEntries(fields.map((field, index) => [field, record[5][index]]));
    if (!approved || compare(approved, payment).length) {
      throw new Error('The released CSV differs from the referenced approval.');
    }
    console.log('Release file matches ' + (fixture ? 'the original training fixture' : 'Diana approval version ' + release.approvalVersion) + '.');
    console.log('Release timestamp and action come from the local simulator.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

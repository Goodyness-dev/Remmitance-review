export const fields = ['reference', 'beneficiary', 'bank', 'account', 'currency', 'amountKobo'];
export const baseline = Object.freeze({
  reference: 'TR-2026-118', beneficiary: 'State A Revenue Authority', bank: '001',
  account: '0000004821', currency: 'NGN', amountKobo: '1240000000',
});
export const altered = Object.freeze({ ...baseline, account: '0000009036' });

export function parsePayment(csv) {
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length !== 2 || lines[0] !== fields.join(',')) {
    throw new Error('Use the provided CSV headers and exactly one payment row.');
  }
  const values = lines[1].split(',');
  const [reference, beneficiary, bank, account, currency, amountKobo] = values;
  if (
    values.length !== fields.length || !/^[A-Z0-9-]{1,40}$/.test(reference) ||
    !/^[A-Za-z0-9 .&()-]{1,100}$/.test(beneficiary) || beneficiary.trim() !== beneficiary ||
    !/^\d{3}$/.test(bank) || !/^\d{10}$/.test(account) ||
    currency !== 'NGN' || !/^[1-9]\d{0,15}$/.test(amountKobo)
  ) throw new Error('The payment row contains invalid or ambiguous values.');
  return { reference, beneficiary, bank, account, currency, amountKobo };
}

export function compare(approved, outgoing) {
  return fields.filter(field => approved[field] !== outgoing[field]);
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

export async function destinationCommitment({ project, bank, account, salt }) {
  return '0x' + await sha256(JSON.stringify([
    'remittance-review/destination/v1', project.toLowerCase(), bank, account, salt.toLowerCase(),
  ]));
}

export async function approvalEvidence({ instruction, version, previous, reason, requester, confirmation, approver }, salt = hex(crypto.getRandomValues(new Uint8Array(32)))) {
  const record = [
    'remittance-review/approval/v1', 'fictional-teaching-hospital', 'qorechain-diana',
    version, previous, fields.map(field => instruction[field]), reason, requester, confirmation, approver, salt,
  ];
  return { record, memo: 'remittance-review:v1:' + await sha256(JSON.stringify(record)) };
}

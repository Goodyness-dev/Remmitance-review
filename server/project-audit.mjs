import { destinationAtVersion, projectChain } from './project-chain.mjs';
import { instructionCommitment, simulatorReceipt } from './project-payout.mjs';
import { destinationCommitment, parsePayment } from './records.mjs';

export const projectBundleFormat = 'remittance-review/project-evidence/v1';
const evmAddress = /^0x[0-9a-f]{40}$/i;
const saltPattern = /^[0-9a-f]{64}$/i;
const blockPattern = /^[1-9][0-9]{0,19}$/;
const snapshotRequest = new Request('https://audit.invalid/api/project-chain');

export async function verifyProjectBundle(bundle, expectedContract, fetchRpc) {
  const { receipt, csv, salt, destinationSalt } = bundle ?? {};
  if (bundle?.format !== projectBundleFormat || !evmAddress.test(expectedContract) ||
      typeof receipt?.contract !== 'string' || receipt.contract.toLowerCase() !== expectedContract.toLowerCase() ||
      receipt.status !== 'settled-by-simulator' || typeof csv !== 'string' || csv.length > 3000 ||
      typeof salt !== 'string' || !saltPattern.test(salt) ||
      typeof destinationSalt !== 'string' || !saltPattern.test(destinationSalt) ||
      typeof receipt.checkedAtBlock !== 'string' || !blockPattern.test(receipt.checkedAtBlock)) {
    throw new Error('Invalid project bundle or unexpected contract address.');
  }
  const outgoing = parsePayment(csv);
  if (outgoing.reference !== receipt.reference || outgoing.amountKobo !== receipt.amountKobo) {
    throw new Error('The file does not match the simulator receipt.');
  }

  const [original, current] = await Promise.all([
    projectChain(snapshotRequest, expectedContract, fetchRpc, receipt.checkedAtBlock),
    projectChain(snapshotRequest, expectedContract, fetchRpc),
  ]).then(results => Promise.all(results.map(result => result.json())));
  if (original.status !== 'confirmed' || current.status !== 'confirmed') {
    throw new Error('Diana could not provide the current and historical contract states.');
  }
  const claim = original.payments.find(item => item.reference === outgoing.reference);
  if (claim?.state !== 'Claimed' || !claim.certified || claim.amountKobo !== outgoing.amountKobo) {
    throw new Error('The historical Diana state does not contain that payout claim.');
  }
  const instruction = await instructionCommitment({
    project: original.project, contract: expectedContract, version: claim.approvedVersion, csv, salt,
  });
  if (instruction !== claim.instruction.toLowerCase() || instruction !== receipt.instruction) {
    throw new Error('The file does not open the claimed Diana instruction.');
  }
  const destination = await destinationCommitment({ project: original.project, ...outgoing, salt: destinationSalt });
  if (destination !== await destinationAtVersion(original, claim.approvedVersion, fetchRpc)) {
    throw new Error('The bank or account does not match the approved destination.');
  }
  const expected = await simulatorReceipt({ contract: expectedContract, reference: outgoing.reference,
    instruction, amountKobo: outgoing.amountKobo });
  if (expected.providerReference !== receipt.providerReference || expected.receiptCommitment !== receipt.receiptCommitment) {
    throw new Error('The simulator receipt commitment does not match the evidence.');
  }
  const payment = current.payments.find(item => item.reference === outgoing.reference);
  if (payment?.instruction.toLowerCase() !== instruction || !['Claimed', 'Settled'].includes(payment.state) ||
      (payment.state === 'Settled' && payment.receipt.toLowerCase() !== expected.receiptCommitment)) {
    throw new Error('The latest Diana state conflicts with the evidence.');
  }
  return {
    status: payment.state === 'Settled' ? 'simulated-receipt-reconciled-on-diana' : 'claim-verified-awaiting-reconciliation',
    contract: expectedContract, reference: outgoing.reference, destinationVersion: claim.approvedVersion,
    claimCheckedAtBlock: original.block, reconciliationCheckedAtBlock: current.block,
  };
}

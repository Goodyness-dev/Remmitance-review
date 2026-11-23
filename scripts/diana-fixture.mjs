import { randomBytes } from 'node:crypto';
import { destinationCommitment, sha256 } from '../server/records.mjs';
import { milestones } from '../server/project-chain.mjs';

const roles = ['preparer', 'contractor', 'reviewer', 'certifier', 'gateway', 'reconciler'];
const addressPattern = /^0x[0-9a-f]{40}$/i;
const saltPattern = /^[0-9a-f]{64}$/i;
const word = number => BigInt(number).toString(16).padStart(64, '0');
const commit = async (kind, values) => '0x' + await sha256(JSON.stringify(['remittance-review/market-road/v1', kind, ...values]));

export async function createDianaFixture(addresses, salt = randomBytes(32).toString('hex')) {
  if (!Array.isArray(addresses) || addresses.length !== roles.length ||
      addresses.some(address => typeof address !== 'string' || !addressPattern.test(address) || BigInt(address) === 0n) ||
      new Set(addresses.map(address => address.toLowerCase())).size !== roles.length) {
    throw new Error('Provide six distinct, nonzero Diana EVM addresses in role order.');
  }
  if (!saltPattern.test(salt)) throw new Error('The fixture salt must contain 32 bytes in hex.');
  salt = salt.toLowerCase();

  const project = await commit('project', [salt]);
  const initialSalt = (await commit('initial-destination-salt', [salt])).slice(2);
  const replacementSalt = (await commit('replacement-destination-salt', [salt])).slice(2);
  const destination = await destinationCommitment({ project, bank: '001', account: '0000004821', salt: initialSalt });
  const replacement = await destinationCommitment({ project, bank: '001', account: '0000009036', salt: replacementSalt });
  const requestEvidence = await commit('change-request', [salt, 'Fictional contractor consolidated its bank accounts']);
  const reviewEvidence = await commit('review', [salt, 'Simulated name-enquiry matches enrolled contractor']);
  const amounts = [400000000, 1200000000, 800000000];
  const dates = ['2026-11-07T12:00:00+01:00', '2026-11-22T12:00:00+01:00', '2026-11-30T12:00:00+01:00'];
  const schedule = await Promise.all(Object.entries(milestones).map(async ([reference, id], index) => {
    const amountKobo = amounts[index];
    const dueAt = Date.parse(dates[index]) / 1000;
    const certificate = await commit('certificate', [salt, reference]);
    return {
      reference, id: '0x' + id, amountKobo, dueAt, certificate,
      scheduleData: '0xe3f0d151' + id + word(amountKobo) + word(dueAt),
      certifyData: '0x3eaf672f' + id + certificate.slice(2),
    };
  }));
  const budget = amounts.reduce((total, amount) => total + amount, 0);
  return {
    network: 'qorechain-diana',
    chainId: 9800,
    fixtureSalt: salt,
    destinationSalts: { 1: initialSalt, 2: replacementSalt },
    project,
    budgetKobo: budget,
    roles: Object.fromEntries(roles.map((role, index) => [role, addresses[index]])),
    constructorArgs: [project, budget, destination, addresses],
    schedule,
    change: {
      replacement, requestEvidence, reviewEvidence,
      requestData: '0x411695e4' + replacement.slice(2) + requestEvidence.slice(2),
    },
  };
}

if (import.meta.main) {
  const addresses = process.argv.slice(2);
  try {
    console.log(JSON.stringify(await createDianaFixture(addresses), null, 2));
  } catch (error) {
    console.error(error.message);
    console.error('Usage: node scripts/diana-fixture.mjs <preparer> <contractor> <reviewer> <certifier> <gateway> <reconciler>');
    process.exitCode = 1;
  }
}

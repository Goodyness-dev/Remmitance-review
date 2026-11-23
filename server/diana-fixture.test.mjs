import assert from 'node:assert/strict';
import test from 'node:test';
import { createDianaFixture } from '../scripts/diana-fixture.mjs';
import { milestones } from './project-chain.mjs';

const addresses = Array.from({ length: 6 }, (_, index) => '0x' + String(index + 1).padStart(40, '0'));
const salt = 'ab'.repeat(32);

test('the Diana fixture covers three scheduled milestones and six distinct roles', async () => {
  const fixture = await createDianaFixture(addresses, salt);
  assert.deepEqual(fixture, await createDianaFixture(addresses, salt));
  assert.deepEqual(fixture.constructorArgs, [fixture.project, 2400000000, fixture.constructorArgs[2], addresses]);
  assert.equal(fixture.roles.reviewer, addresses[2]);
  assert.equal(fixture.schedule.length, 3);
  const drainage = fixture.schedule[1];
  assert.equal(drainage.id, '0x' + milestones['ROAD-02']);
  assert.equal(drainage.amountKobo, 1200000000);
  assert.equal(drainage.scheduleData.slice(10, 74), drainage.id.slice(2));
  assert.equal(BigInt('0x' + drainage.scheduleData.slice(74, 138)), 1200000000n);
  assert.equal(drainage.certifyData.slice(74), drainage.certificate.slice(2));
  assert.notEqual(fixture.change.replacement, fixture.constructorArgs[2]);
});

test('the deployment manifest refuses missing, zero and repeated roles', async () => {
  await assert.rejects(createDianaFixture(addresses.slice(1), salt), /six distinct/);
  await assert.rejects(createDianaFixture([...addresses.slice(0, 5), addresses[0]], salt), /six distinct/);
  await assert.rejects(createDianaFixture([...addresses.slice(0, 5), '0x' + '0'.repeat(40)], salt), /six distinct/);
});

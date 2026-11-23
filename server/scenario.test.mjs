import assert from 'node:assert/strict';
import test from 'node:test';
import { initialScenario, transition } from '../src/scenario.mjs';

test('the guided review holds the swapped payment, rejects the stale approval and closes after settlement', () => {
  let state = transition(initialScenario, 'swap');
  assert.equal(state.phase, 'held');
  assert.equal(state.approved, '4821');
  assert.equal(state.outgoing, '9036');
  assert.match(state.alert, /Treasury reviewer/);
  assert.equal(transition(state, 'authorize'), state);
  assert.equal(transition(state, 'settle'), state);
  assert.equal(state.notifications.contractor, 'failed');
  state = transition(state, 'retry-delivery');
  assert.equal(state.notifications.contractor, 'delivered');
  assert.equal(transition(state, 'retry-delivery'), state);
  state = transition(state, 'acknowledge');
  assert.equal(state.notifications.treasury, 'acknowledged');
  assert.equal(transition(state, 'acknowledge'), state);

  state = transition(state, 'request');
  assert.equal(transition(state, 'approve'), state);
  state = transition(state, 'confirm');
  assert.equal(state.notifications.contractor, 'acknowledged');
  state = transition(state, 'approve');
  assert.equal(state.version, 2);
  assert.equal(state.approved, state.outgoing);

  state = transition(state, 'retry');
  assert.equal(state.phase, 'rejected');
  assert.match(state.events.at(-1), /Version 1 authorization rejected/);
  state = transition(state, 'authorize');
  assert.equal(transition(state, 'finish'), state);
  state = transition(state, 'settle');
  assert.equal(transition(state, 'settle'), state);
  state = transition(state, 'finish');
  assert.equal(state.phase, 'closed');
  assert.equal(transition(state, 'authorize'), state);
  assert.equal(transition(state, 'reset'), initialScenario);
});

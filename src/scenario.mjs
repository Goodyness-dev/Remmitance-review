const approved = '4821';
const replacement = '9036';

export const initialScenario = {
  phase: 'ready',
  version: 1,
  approved,
  outgoing: approved,
  events: [],
  alert: null,
  notifications: null,
};

export function transition(state, action) {
  const record = (phase, title, fields = {}) => ({
    ...state, ...fields, phase, events: [...state.events, title],
  });
  switch (action) {
    case 'swap':
      if (state.phase === 'ready') return record('held', 'Outgoing file first observed with account ending 9036.', {
        outgoing: replacement,
        alert: 'Treasury reviewer notified. The first delivery to the enrolled contractor contact failed.',
        notifications: { treasury: 'delivered', contractor: 'failed' },
      });
      break;
    case 'retry-delivery':
      if (state.phase === 'held' && state.notifications.contractor === 'failed') {
        return record('held', 'Retry delivered the alert to the enrolled contractor contact.', {
          alert: 'The treasury reviewer and enrolled contractor contact received the alert.',
          notifications: { ...state.notifications, contractor: 'delivered' },
        });
      }
      break;
    case 'acknowledge':
      if (state.phase === 'held' && state.notifications.treasury === 'delivered') {
        return record('held', 'Treasury reviewer acknowledged the destination alert.', {
          notifications: { ...state.notifications, treasury: 'acknowledged' },
        });
      }
      break;
    case 'retry':
      if (state.phase === 'approved') return record('rejected', 'Version 1 authorization rejected. The current destination is version 2.');
      break;
    case 'request':
      if (state.phase === 'held') {
        return record('requested', 'Training preparer requested the replacement. Stated reason: contractor consolidated its banking.');
      }
      break;
    case 'confirm':
      if (state.phase === 'requested') return record('confirmed', 'Enrolled contractor contact confirmed the exact replacement account.', {
        notifications: { ...state.notifications, contractor: 'acknowledged' },
      });
      break;
    case 'approve':
      if (state.phase === 'confirmed') return record('approved', 'Independent treasury reviewer checked the simulated account-name response and approved version 2.', {
        version: 2,
        approved: replacement,
        alert: 'Review complete. The old release authorization has expired.',
      });
      break;
    case 'authorize':
      if (state.phase === 'rejected' && state.approved === state.outgoing) {
        return record('authorized', 'Training scenario authorized the outgoing instruction for destination version 2.');
      }
      break;
    case 'settle':
      if (state.phase === 'authorized') return record('settled', 'Simulator receipt verified for the milestone payment.');
      break;
    case 'finish':
      if (state.phase === 'settled') return record('closed', 'The final milestone was reconciled and the project was closed.');
      break;
    case 'reset':
      return initialScenario;
  }
  return state;
}

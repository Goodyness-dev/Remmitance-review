# Remittance Review

## Project description

Remittance Review lets funders spot a changed bank destination before releasing a public works payment. In the wallet-free Market Road walkthrough, a fictional ₦12 million payout is held after the outgoing bank account changes. The reviewer compares masked payment details, examines the alert, and sees a stale approval rejected before the revised instruction is authorized and reconciled in the simulator.

## How it was made

The React app uses Three.js for the side-by-side evidence view and includes a text comparison. The project began with create-qorechain-dapp. QoreX supplies the native hybrid-signing flow and signs structured contract approval digests when the wallet supports it. The Solidity contract models milestone certification, destination versions, independent review, a one-time claim and settlement. The server compares the exact CSV and account with the Diana claim before the simulator issues a receipt. An auditor can independently check exported evidence against the configured contract.

## Submission fields

| Field | Evidence |
|---|---|
| Category | Quantum Pass |
| Source and licence | MIT source package. Add the public repository URL when published. |
| Hosted walkthrough | Add the organizer-facing Vercel URL after deployment and smoke testing. |
| Diana contract | `0x38feac738e816997ead2fe7dbe0fefda9f046a78`, deployed at block 10611906 in transaction `0x78e9656b13d49ad96a7ddc7a4512c61fbf5cdfcd9460490c4e1d5587db1e07fe`. |
| Native hybrid proof | Add the funded QoreX testnet `qor1` address and the verified native transaction hash. |
| Signed contract approval | Add the committed Diana EVM transaction hash and the verified approval evidence. |
| Cover | Use the organizer-generated cover or supply a 16:9 capture of the Market Road hold. The legacy training-desk image is 1440 × 1000. |
| Video | Use the road-project demo script. Recording is deferred. |

The organizer requires a public repository, a video of up to three minutes, a valid testnet address and a hybrid-signed transaction for Quantum Pass. The project is due by 2 December 2026 at 23:59 UTC, which is 3 December at 00:59 WAT. [Submission requirements](https://build.qorechain.io/start) · [Quantum Pass rules](https://build.qorechain.io/prizes)

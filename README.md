# Remittance Review

An interactive payment review for funded projects. The homepage runs a wallet-free fictional road project through a beneficiary discrepancy, a funder alert, a stale approval refusal and simulated settlement. The linked `/desk` route is the original single-payment training workflow with real Diana receipt verification.

## Run locally

Use Node.js 24 with built-in SQLite. Run `npm ci`, `npm test`, `npm run build`, then `npm start`. Open http://127.0.0.1:5173. The development entry point is `npm run dev`.

A hosted training instance needs a Node service behind HTTPS and a private persistent volume for SQLite. Set HOST and PORT for the hosting provider, and set REMITTANCE_DB to the database location. Start in the project directory.

### Container deployment

```sh
docker build -t remittance-review .
docker run --rm -p 127.0.0.1:5173:5173 -v remittance-review-data:/var/lib/remittance-review remittance-review
```

For an HTTPS host, configure its health check at `/healthz` and mount writable storage at `/var/lib/remittance-review`. Run one replica for this training deployment. A Docker-compatible host can build from the supplied Dockerfile.

For a Worker host, `npm run build:worker` creates `dist/server/index.js` with the browser assets bundled. Use a D1 binding named `DB` and apply the schema in `drizzle/0000_desks.sql` before serving requests. The hosting manifest identifies the private training Site.

### Vercel

Import the repository in Vercel. If it contains the parent workspace, choose `remittance-review` as the root directory. Use the Vite preset and Node.js 24. The repository's Vercel configuration supplies the build, output and `/desk` route.

Connect an Upstash Redis database to the Vercel project. The function reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. It also supports the equivalent `KV_REST_API_URL` and `KV_REST_API_TOKEN` supplied by some integrations. Set these in Vercel's server-side environment and deploy.

On the resulting HTTPS origin, open `/` for the guided project, check `/api/healthz` for storage connectivity, and open `/desk` for the live QoreX signing workflow. Use fictional records in both training views. The project scenario runs locally in the browser and resets on reload. The Solidity contract in `contracts/ProjectPayments.sol` models the on-chain project state. The project UI currently exercises a simulation independently of that contract.

Set the server-side `REMITTANCE_DIANA_CONTRACT` to a deployed Diana ProjectPayments address to show its live state below the scenario. Set `REMITTANCE_DIANA_DEPLOYMENT_BLOCK` to the decimal deployment block to enable paginated transaction history. Seed milestone IDs as `keccak256(bytes("ROAD-01"))`, `ROAD-02` and `ROAD-03` using the same encoding. The panel polls contract state every 30 seconds and displays an in-app inbox alert for a pending change. The event history is loaded on demand for the configured contract and shows its block coverage.

The training inbox persists rejected instructions by milestone, destination version and failure type. It keeps the first observed time and displays these reports as unverified submissions with an unknown editor. The review deadline is within 24 hours of first observation or by the payment due time, whichever comes first. An already-due payment goes straight to the supervisor queue. Closed, completed and superseded reports remain available in the history. Contract change requests have their own confirmed hold status. The training inbox is visible to demo visitors and contains milestone, version, amount, timing and failure category. The supervisor queue is in-app. A live pilot requires authenticated operators and private alert delivery.

Use the [Diana runbook](DIANA_RUNBOOK.md) to compile the contract, generate the three-milestone deployment fixture and exercise the signed workflow with enrolled test accounts.

### QoreX contract approval

In the Diana panel, open **Prepare a live QoreX approval**. The contractor can confirm a pending destination, and the separately enrolled treasury reviewer can decide the change or authorize an exact milestone instruction. For a milestone authorization, upload the fictional payout file and enter both salts. The app checks its bank, account and amount against Diana before preparing the signing request, then shows the masked bank details, version and instruction commitment. Review the operation and required signer, then sign from that enrolled Diana account. Use a QoreX client that advertises `signArbitrary`. The app simulates the signed call against the contract at a recorded Diana block. A successful check yields a downloadable call for a transaction sender with an active Diana EVM window scoped to the project contract. A state change or expiry can invalidate that call before it lands. Verify the committed transaction before relying on the decision.

The downloaded JSON contains `contract` and `data`, the destination and calldata for a zero-value Diana transaction. Treat the file as an actionable approval until it expires. An auditor can independently verify the mined call using `node scripts/verify-project-call.mjs diana-project-call.json <evm-transaction-hash>`. Use the native receipt desk for Quantum Pass evidence or when the current wallet only supports `signAndBroadcast`. The native proof and a committed EVM contract approval are distinct. [QoreX compatibility and signing](https://build.qorechain.io/faq) · [QoreSign envelope](https://docs.qorechain.io/qoresign/spec/message-signing-v1/)

After submitting the signed call, paste its transaction hash into the approval panel. The panel checks the mined receipt and exact calldata before offering a verified approval evidence download.

### Test a Diana-gated simulated payout

1. With the configured contract, prepare a synthetic CSV for a scheduled and certified milestone. Run `node scripts/commit-payment.mjs <contract> <project-id> <destination-version> <training.csv>`. Keep the salt and original file together. The commitment covers the exact UTF-8 file, including the line endings, chain, contract, project and destination version.
2. Have the enrolled reviewer authorize that commitment on Diana and the gateway claim it. Reload the Vercel project view to see its status. Upload the original fictional CSV and enter its instruction salt plus the destination salt from the fixture for the claimed version. The server checks the claim, amount, version and exact file commitment, then independently checks the bank and account against the approved destination for that version.
3. Repeat the request and verify the simulator returns the same receipt. A changed CSV must fail. The reconciler can submit the returned receipt and provider reference commitments with the contract's `settle` call. No payment provider or real account participates in this test. The simulator stores only synthetic reference, amount and commitment metadata.

Download the restricted project evidence after a simulated payout. An auditor can run `node scripts/verify-project-payout.mjs restricted-training-project-evidence.json <expected-diana-contract>` outside the app. Use the contract address from the deployment record. The verifier reads Diana at the recorded claim block and at the current head, checks both commitments against the original file, and reports whether the simulator receipt is reconciled on Diana. It requires a Diana RPC that serves the historical block. A locally reproducible simulator commitment is evidence of the matching instruction, and a reconciled receipt adds the on-chain settlement attestation. Neither indicates movement of real funds. The export contains the original CSV and both salts. Share it only with the auditor.

## Walk through the case

1. The release desk starts on hold. Compare the approved account ending 4821 with the final file ending 9036. Trace the first observed difference in the evidence history.
2. Switch to Bursary preparer. Import the sample training CSV, then request the replacement account with a reason.
3. Switch to Receiving authority and confirm the proposed destination.
4. Switch to Approving officer. Connect a funded QoreX wallet on Diana testnet. The one-micro-QOR self-transfer records the approval digest in its memo and uses testnet fees. Check again if the transaction is still pending.
5. Return to Release officer. The current file must match the signed instruction before the desk enables simulated release.
6. In Internal audit, download the restricted evidence. Run `node verify-evidence.mjs restricted-training-evidence.json` to check approval fingerprints, revision links and confirmed receipts directly against Diana. After simulated release, the export also preserves the original CSV and its fingerprint. The verifier checks that those bytes match the referenced approval version. The release action and time come from the local simulator. The verifier runs independently of the original server and database.

The starting approval, role selection and wallet enrollment are synthetic training functions. Use fictional files exclusively. A live institution would supply authenticated roles, independent beneficiary enrollment and a release integration.

## Credits

Generated using create-qorechain-dapp 0.14.0 and its fullstack-web template. Uses React, Vite, Three.js, Cosmos protobuf definitions via cosmjs-types, and the QoreX native provider. [Scaffolder](https://docs.qorechain.io/developer-tools/scaffolders-and-cli/) · [QoreX integration](https://docs.qorechain.io/developer-tools/qorex-integrations/)

The use case draws on an ICPC case involving altered tax remittance destinations. The people, figures, accounts and times in the interface are fictional. [ICPC report](https://icpc.gov.ng/icpc-case-court-jails-uduths-accountant-for-diversion-of-over-n60m-via-gifmis/)

The HTTP workflow tests supply controlled Diana responses. See the [demo script](DEMO_SCRIPT.md) for the project scenario. The existing featured image is from the single-payment desk. Live wallet verification, a hosted URL and a recorded demonstration remain pending.

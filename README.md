# Remittance Review

An interactive release desk for a fictional Nigerian teaching hospital. Compare the outgoing file with the approved beneficiary instruction before a simulated naira payment is released.

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

The HTTP workflow test supplies a controlled Diana response. [Featured image](featured.png) and [demo script](DEMO_SCRIPT.md) are ready. Live wallet verification, a hosted URL and a recorded demonstration remain pending.

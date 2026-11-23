# Deploy and exercise Market Road on Diana

## Verified Market Road deployment

The deployment succeeded on Diana chain ID 9800. The production app's readers verified all three scheduled and certified milestones and the six corresponding history events at block 10612014. Use these testnet settings on Vercel.

```dotenv
REMITTANCE_DIANA_CONTRACT=0x38feac738e816997ead2fe7dbe0fefda9f046a78
REMITTANCE_DIANA_DEPLOYMENT_BLOCK=10611906
```

Deployment transaction `0x78e9656b13d49ad96a7ddc7a4512c61fbf5cdfcd9460490c4e1d5587db1e07fe`. The deployment uses separate disposable testnet addresses for its six roles. The remaining wallet walkthrough can use those enrolled accounts.

## Role setup for a fresh deployment

Use disposable Diana wallets. Enrollment takes six distinct public EVM addresses. The contractor and reviewer sign approval messages in QoreX and need registered ML-DSA-87 keys. The deployer, preparer, certifier, gateway, reconciler and signed-call submitter need test QOR and a Diana EVM window for the transactions they send. One account may handle deployment and submit the signed calls. The six contract roles still have to be distinct. Use local keystores or wallet prompts for secrets. [QoreChain EVM setup](https://docs.qorechain.io/developer-guide/evm-development/) · [EVM window and QoreX FAQ](https://build.qorechain.io/faq)

## Deploy and seed

From this repository in PowerShell, set the six address variables from your enrollment records. The fixture prints public deployment arguments, three milestone calls and the fictional change request.

```powershell
$dianaRpc = 'https://evm-testnet.qore.host'
$originalFixture = node scripts/diana-fixture.mjs $preparer $contractor $reviewer $certifier $gateway $reconciler
if ($LASTEXITCODE -ne 0) { throw 'Fixture generation failed' }
$originalFixture | Set-Content -Encoding utf8 diana-market-road.json
$fixture = Get-Content -Raw diana-market-road.json | ConvertFrom-Json
$roleArgument = '[' + ($fixture.constructorArgs[3] -join ',') + ']'
forge build
forge create contracts/ProjectPayments.sol:ProjectPayments --rpc-url $dianaRpc --account diana-deployer --broadcast --constructor-args $fixture.project $fixture.budgetKobo $fixture.constructorArgs[2] $roleArgument
```

The deployer needs a window that permits contract creation. QoreChain refuses creation in a target-allowlisted window. For later calls, scope the window to the deployed contract. Set `$projectContract` to the mined address and record its deployment transaction and block.

```powershell
cast call $projectContract 'project()(bytes32)' --rpc-url $dianaRpc
foreach ($milestone in $fixture.schedule) {
  cast send $projectContract --data $milestone.scheduleData --rpc-url $dianaRpc --account diana-preparer
  if ($LASTEXITCODE -ne 0) { throw 'Scheduling failed' }
  cast send $projectContract --data $milestone.certifyData --rpc-url $dianaRpc --account diana-certifier
  if ($LASTEXITCODE -ne 0) { throw 'Certification failed' }
}
```

Set `REMITTANCE_DIANA_CONTRACT` to that address and `REMITTANCE_DIANA_DEPLOYMENT_BLOCK` to the decimal deployment block in Vercel. The homepage's Diana panel should show the same contract, destination version 1 and the three certified milestones. Verify `/api/healthz` before recording a payout. For each command, use the matching local keystore name or equivalent wallet. Record the resulting transaction hashes and outcomes.

Run `node scripts/check-release.mjs <public-origin> <expected-diana-contract>` after the Vercel deployment. It checks the built app, wallet desk, persistent review, certified milestone state, Diana history and reviewer inbox before the live wallet walkthrough.

## Verify one rejected and one accepted payout

1. First authorize, claim and settle `fixtures/road-01-approved.csv` under version 1. Then authorize `fixtures/road-02-approved.csv`. In the homepage's QoreX approval panel, upload the file, supply the instruction salt from `scripts/commit-payment.mjs` and use the fixture's version 1 destination salt. The panel checks the full destination and shows the masked payment details before signing. Download each authorization, submit it before expiry and verify it independently.
2. As preparer, send `$fixture.change.requestData` to the project contract. Confirm that the homepage shows the hold and that a gateway call for the prior commitment reverts.
3. As contractor, sign **Confirm destination** and submit the call. As the independent reviewer, sign **Approve** with `$fixture.change.reviewEvidence` and submit. Verify version 2 and attempt the prior claim again. It should still revert.
4. Generate a new commitment using version 2 and `fixtures/road-02-replacement.csv`. Authorize it as reviewer. The gateway claims it. In the homepage, submit the altered file or wrong salt to verify refusal. Upload the exact replacement fixture, its instruction salt and `$fixture.destinationSalts.'2'` to produce the simulator receipt. Use `$fixture.destinationSalts.'1'` for a version 1 payout.
5. As reconciler, submit the receipt and provider-reference commitments. Rerun the simulator lookup to confirm it recognizes the chain receipt. Repeat the authorize, claim and settlement sequence with `fixtures/road-03-replacement.csv` under version 2, then call `close()` as reconciler.

```powershell
$approval = Get-Content -Raw diana-project-call.json | ConvertFrom-Json
if ($approval.contract -ne $projectContract) { throw 'Approval points to another contract' }
cast send $projectContract --data $approval.data --rpc-url $dianaRpc --account diana-submitter
node scripts/verify-project-call.mjs diana-project-call.json $approvalTransaction

$drainage = $fixture.schedule[1].id
cast send $projectContract 'claim(bytes32,bytes32)' $drainage $instructionCommitment --rpc-url $dianaRpc --account diana-gateway
cast send $projectContract 'settle(bytes32,bytes32,bytes32)' $drainage $receiptCommitment $providerReference --rpc-url $dianaRpc --account diana-reconciler
```

Use the native QoreX desk as a separate Quantum Pass receipt flow. Include the contract address, deployment transaction, confirmed approval transaction and native hybrid transaction in the public submission after they are verified. Keep the CSV and both salts restricted for any future institution, and use public fixtures exclusively for the testnet walkthrough.

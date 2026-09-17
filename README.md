# Terra Classic Bridge Monitor

Public, real-time health dashboard for the **Terra Classic Hyperlane bridge**
(Terra Classic ↔ BSC · Ethereum · Solana). Built with Next.js 16, React 19 and Tailwind 4.

It answers three questions at a glance:

| Section | Question | How it is measured |
|---|---|---|
| **Relayer** | Are transfers being delivered? | Recent dispatches on each origin chain are looked up on the destination mailbox (`delivered` / processed PDA / `message_delivered`). A message still undelivered after `PENDING_WARN_MINUTES` turns the route yellow, after `PENDING_DOWN_MINUTES` red. Deliveries into Terra Classic are also read from the TC mailbox `process` events. |
| **Operator balances** | Can the relayer still pay for gas? | Native balance of the relayer wallet on the 4 chains vs. `warn` / `critical` thresholds. |
| **Validator checkpoints** | Are the validators that secure each route signing the latest checkpoints? | For each origin chain the validator set is read **on-chain** (multisig ISM of the warp routes on BSC/Ethereum for TC-origin messages; Terra Classic routing ISM for BSC/Ethereum/Solana-origin messages). Each validator's announced storage location (ValidatorAnnounce) is read on-chain and its `checkpoint_latest_index.json` is compared with the origin merkle tree count. A set is healthy when at least `threshold` validators are synced. |
| **Operator agents** (optional) | What do the relayer/validator processes themselves report? | Prometheus metrics of your own agents (`RELAYER_METRICS_URL`, `VALIDATOR_METRICS_URL`). Hidden when not configured. |

Everything is public data: the [Terra Classic Hyperlane registry](https://github.com/terra-classic-hyperlane/hyperlane-registry)
(branch `public-warp`), public RPC/LCD endpoints and the validators' public checkpoint buckets.
No contract address or validator list is hardcoded.

## Endpoints

- `/` — dashboard (auto-refreshes every 30 s)
- `/api/status` — full JSON snapshot (CORS enabled, cached `SNAPSHOT_TTL_SECONDS`)
- `/api/health` — `200` when healthy/degraded, `503` when something is down (for uptime monitors)

## Run locally

```bash
pnpm install
cp .env.example .env.local   # optional, everything has defaults
pnpm dev                     # http://localhost:3000
```

`pnpm typecheck`, `pnpm lint`, `pnpm build`.

## Configuration

All variables are optional — see `.env.example`. The ones that matter in production:

- `RPC_SOLANAMAINNET`, `RPC_BSC`, `RPC_ETHEREUM` — private RPCs (server-side only). Public
  RPCs rate-limit the scans; the dashboard then shows partial data with a note.
- `OPERATOR_*` — relayer wallets to watch (defaults: Terra Classic community relayer).
- `BALANCE_THRESHOLDS` — JSON with `warn` / `critical` per chain.

## Deploy

Docker (EasyPanel, Coolify, any container host):

```bash
docker build -t tc-monitoring-hyperlane .
docker run -p 3000:3000 --env-file .env tc-monitoring-hyperlane
```

The image uses Next.js standalone output; one instance keeps one shared snapshot in memory.

## Operator agents (optional)

Hyperlane agents expose Prometheus metrics (relayer `:9091/metrics`, validator `:9090/metrics`)
on localhost of the operator machine. To feed them into the dashboard without exposing the
ports publicly, put them behind nginx with basic auth on the VPS:

```nginx
server {
  listen 443 ssl;
  server_name metrics.example.com;
  # ssl_certificate ...; ssl_certificate_key ...;
  auth_basic "metrics";
  auth_basic_user_file /etc/nginx/.htpasswd;   # htpasswd -c /etc/nginx/.htpasswd monitor
  location /relayer/metrics   { proxy_pass http://127.0.0.1:9091/metrics; }
  location /validator/metrics { proxy_pass http://127.0.0.1:9090/metrics; }
}
```

Then set:

```
RELAYER_METRICS_URL=https://metrics.example.com/relayer/metrics
VALIDATOR_METRICS_URL=https://metrics.example.com/validator/metrics
METRICS_AUTH_HEADER=Basic <base64 user:pass>
```

The dashboard shows submission queue backlog, critical errors, sync liveness per chain and the
validator's announced / signed checkpoint. Only the server reads these URLs.

## How the checks work (details)

- **Terra Classic** (CosmWasm): LCD smart queries — `mailbox.message_delivered`, `merkle_hook.count`,
  `get_announce_storage_locations`, `routing_ism.route` → `multisig_ism.enrolled_validators`;
  tx search on the mailbox contract for `wasm-mailbox_dispatch(_id)` and `wasm-mailbox_process(_id)`.
- **BSC / Ethereum** (viem): `delivered(bytes32)`, `MerkleTreeHook.count()`,
  `ValidatorAnnounce.getAnnouncedStorageLocations`, `Multisig ISM.validatorsAndThreshold`,
  `Dispatch` logs filtered by destination domain (chunked, parallel).
- **Solana** (@solana/web3.js): processed-message PDA, outbox account (merkle count),
  validator-announce PDAs, dispatch logs of the TC warp programs.
- **Checkpoints**: `s3://bucket/region[/prefix]` → `https://bucket.s3.region.amazonaws.com/.../checkpoint_latest_index.json`
  (`Last-Modified` is used as the checkpoint time).

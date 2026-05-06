# Deploy self-hosted (Cloudflare / Docker)

## Render pre-deploy checklist (GitHub push only)

- Use deploy por **push no GitHub** (evitar upload parcial de arquivos).
- Confirmar no repo remoto: `server.js`, `lib/library.js`, `lib/effect-parser.js`, `package.json`.
- Confirmar no Render:
  - `Root Directory` = raiz do repo
  - `Build Command` = `npm ci`
  - `Start Command` = `npm start`
- Rodar local antes do push:
  ```powershell
  npm run render:preflight
  ```

## Modes

### Mode A - Docker otimizado (app + tunnel em container)

Use quando quiser simplicidade operacional.

Start diario (sem rebuild):

```powershell
docker compose --profile cloudflare up -d app cloudflared
```

Use `--build` apenas quando mudar codigo/dependencias.

#### Modo performance Docker (seguro)

- `app` roda em processo unico (sem cluster) para manter multiplayer em memoria consistente.
- CPU pinning ativo no compose:
  - `cpuset: 0-13`
  - `cpus: 14.0`
  - `UV_THREADPOOL_SIZE=14`
- Reserva 2 threads para o host (Windows + Docker Desktop), reduzindo travadas gerais.

Checklist rapido:

```powershell
docker compose ps
curl.exe -sS http://127.0.0.1:25565/health
docker inspect chaotic-app --format "{{.HostConfig.CpusetCpus}} / {{.HostConfig.NanoCpus}}"
docker stats chaotic-app
```

### Mode B - High Performance (Node local + tunnel em container)

Use quando o Docker Desktop estiver gargalando no Windows.

```powershell
start-highperf-cloudflare.bat start
```

Esse modo roda o `server.js` no host (porta `3000`) e sobe apenas `cloudflared-host` no Docker.
Os dois modos usam o mesmo banco: `runtime/chaotic.db`.

---

## Prerequisites
- Docker Desktop running.
- Cloudflare account with a domain added to Cloudflare DNS.
- A Tunnel created in Cloudflare Zero Trust.
- Tunnel token (`CF_TUNNEL_TOKEN`).

## Configure env
1. Copy `.env.example` to `.env`.
2. Fill at least:
   - `CF_TUNNEL_TOKEN`
   - `APP_PUBLIC_PORT=25565`
   - SMTP vars for real email verification (`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)

## Cloudflare hostname mapping

In Zero Trust Tunnel Public Hostname:
- for Mode A, origin: `http://app:3000`
- for Mode B, origin: `http://host.docker.internal:3000`

> Important: one hostname points to one origin at a time.  
> If you switch from Mode A to Mode B, update the Public Hostname origin in Cloudflare first.

## Quick checks

```powershell
docker compose ps
curl.exe -sS http://127.0.0.1:25565/health
curl.exe -I https://your-hostname.yourdomain.com/
```

## Diagnostics checklist

- Container usage:
  ```powershell
  docker stats chaotic-app chaotic-cloudflared
  ```
- Cloudflare tunnel logs:
  ```powershell
  docker compose logs --tail=120 cloudflared
  ```
- Highperf local Node log:
  - `runtime/highperf-node.log`

## Optional legacy mode: DuckDNS + Caddy (needs 80/443 open)

Use only when your router/ISP allows inbound 80/443.

```powershell
docker compose --profile duckdns up -d --build
```

Services:
- `app`
- `caddy`
- `duckdns`

## Backup SQLite (Windows Task Scheduler)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\path\chaotic-api-main\scripts\backup-sqlite.ps1"
```

Backups are saved in `backups/` with 14-day retention by default.

## SQLite repair runbook (runtime corruption)

Use when logs show `database disk image is malformed`.

1. Stop app first:
   ```powershell
   docker compose stop app
   ```
   (If using highperf mode, stop `node server.js` local process.)

2. Run one-shot repair:
   ```powershell
   python .\scripts\repair_runtime_db.py
   ```

3. Start again:
   ```powershell
   docker compose --profile cloudflare up -d app cloudflared
   ```
   Or highperf:
   ```powershell
   start-highperf-cloudflare.bat start
   ```

4. Post-repair checklist:
   ```powershell
   curl.exe -sS http://127.0.0.1:25565/health
   docker compose logs --tail=120 app
   ```
   Confirm `/health` reports:
   - `db.sqliteFile` pointing to `runtime/chaotic.db`
   - `db.dbIntegrityStatus = "ok"`
   - `db.profilesReadable = true`

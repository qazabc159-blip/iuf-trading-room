# EC2 C1 Repo Runbook — Market Agent Host

**Date**: 2026-04-30
**Author**: Elva
**Trigger**: 楊董 verbatim「AWS Windows EC2 feasibility spike：APPROVED」+ USD 5/day budget approved

**Scope**: C1 = repo-side runbook + Security Group + install plan，**no live AWS console action**，no secret exposure。等楊董 dry-run review 後做 C2（console 動作）。

---

## 1. Target State

```
┌──────────────────┐     HTTPS push     ┌──────────────────┐
│ AWS Windows EC2  │  ────────────────► │ Railway api      │
│ ap-northeast-1   │     +HMAC sig      │ /api/v1/         │
│ (Tokyo)          │                    │ market-data/     │
│ ─────────────    │                    │ ingest           │
│ KGI SDK + Market │                    └──────────────────┘
│ Agent Python svc │                            │
│                  │                            ▼
│ Outbound only    │                    ┌──────────────────┐
│ (no public 8787) │                    │ Redis snapshot   │
└──────────────────┘                    │ + Postgres bars  │
        ▲                               └──────────────────┘
        │ RDP 限 IP                              │
        │ + Tailscale ops                        ▼
   楊董 (operator)                       ┌──────────────────┐
                                         │ Web SSE → 公司頁 │
                                         └──────────────────┘
```

---

## 2. Instance Spec

| Item | Spec | 月成本估算 |
|---|---|---|
| Region | ap-northeast-1 (Tokyo) | — |
| AZ | ap-northeast-1a | — |
| Type | t3.large (2 vCPU / 8 GB RAM) | — |
| OS | Windows Server 2022 English | License built-in |
| Storage | 50 GB gp3 | ~USD 5/mo |
| Elastic IP | 1 (associated) | USD 0 if attached |
| Network | egress only | per-GB |
| **Spike daily** | t3.large on-demand 24h | **~USD 4.5/day** |
| **長期 reserved** | t3.large 1yr no upfront | ~USD 60/mo（後評估） |

**Budget hard cap**: USD 5/day spike，跑 1-2 day feasibility 後關機。確認 viable 再走 reserved。

---

## 3. Security Group Plan

### Inbound (高度限制)

| Port | Source | Purpose |
|---|---|---|
| **3389** RDP | **楊董家用 IP /32 only** | Remote admin |
| **22** SSH | (disabled — Windows 沒 SSH server 預設) | — |
| **8787** gateway | **NONE — public 禁止** | 內部 Market Agent only |
| **80/443** | NONE | 不對外 expose |

### Outbound

| Port | Dest | Purpose |
|---|---|---|
| 443 HTTPS | 0.0.0.0/0 | Railway api ingest + KGI HTTPS |
| 53 DNS | 168.63.129.16 | DNS resolution |
| 80 HTTP | KGI servers (TBD list) | KGI SDK fallback |

### 重要約束

- **公開 8787 NEVER** — Market Agent 只 outbound push，不 inbound listen
- **RDP 必限 IP /32** — 楊董家用 IP 變動則用 Cloudfront-style allowlist 或 Tailscale RDP（後評估）
- **No 0.0.0.0/0 inbound 任何 port**

---

## 4. AWS CLI Dry-run（不執行）

```powershell
# AWS Account: 027903151493 (IUF 專用 — per memory `feedback_aws_account_lesson`)
# Profile: must be IUF, not other project keys

# 1. VPC + subnet
aws ec2 create-vpc --cidr-block 10.10.0.0/16 --tag-specifications 'ResourceType=vpc,Tags=[{Key=Project,Value=IUF-MarketAgent}]'
aws ec2 create-subnet --vpc-id <vpc-id> --cidr-block 10.10.1.0/24 --availability-zone ap-northeast-1a

# 2. Security Group
aws ec2 create-security-group --group-name iuf-market-agent-sg --description "IUF Market Agent" --vpc-id <vpc-id>
aws ec2 authorize-security-group-ingress --group-id <sg-id> --protocol tcp --port 3389 --cidr <YANG_HOME_IP>/32

# 3. Key Pair
aws ec2 create-key-pair --key-name iuf-market-agent --query 'KeyMaterial' --output text > iuf-market-agent.pem
# (.pem 檔不入 repo — 楊董本地保管 + Windows Credential Manager)

# 4. Launch instance
aws ec2 run-instances `
  --image-id ami-0xxxxx (Win Server 2022 English Tokyo AMI) `
  --instance-type t3.large `
  --key-name iuf-market-agent `
  --security-group-ids <sg-id> `
  --subnet-id <subnet-id> `
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=50,VolumeType=gp3}' `
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=iuf-market-agent-spike-2026-04-30}]'

# 5. Allocate Elastic IP
aws ec2 allocate-address --domain vpc
aws ec2 associate-address --instance-id <inst-id> --allocation-id <eip-alloc-id>
```

**所有指令 dry-run 限定** — 楊董 review 後才執行。

---

## 5. Install Checklist (RDP 後執行)

### 5.1 系統層

- [ ] Windows Update 跑完
- [ ] Disable IE Enhanced Security Configuration（Server Manager → Local Server）
- [ ] Set timezone Asia/Taipei
- [ ] Install Chocolatey
  - `Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))`

### 5.2 Runtime 層

- [ ] `choco install python311 -y` (Python 3.11.x)
- [ ] `choco install git -y`
- [ ] `choco install nssm -y` (Windows service wrapper)
- [ ] `pip install poetry`

### 5.3 KGI SDK

- [ ] `pip install kgisuperpy==1.0.4`
- [ ] **U1 verify**：跑最小 import test：
  ```python
  import kgisuperpy
  api = kgisuperpy.Shioaji()  # 預期 import OK on Windows Server 2022
  ```
- [ ] 若 import FAIL → 落 evidence + 立刻 escalate（per `project_path_c_linux_spike_result` precedent）

### 5.4 Market Agent (Lane D 產出)

- [ ] `git clone https://github.com/qazabc159-blip/iuf-trading-room.git C:\iuf-trading-room`
- [ ] `cd C:\iuf-trading-room\services\market-agent`
- [ ] `poetry install --no-dev`
- [ ] 設定 env vars (Windows Credential Manager DPAPI)：
  - `KGI_PERSON_ID` (大寫 — per `feedback_kgi_env_var_uppercase_rule`)
  - `KGI_PERSON_PWD`
  - `KGI_CA_PFX_PATH`
  - `KGI_CA_PWD`
  - `MARKET_AGENT_HMAC_SECRET`
  - `IUF_INGEST_URL` = `https://api.eycvector.com/api/v1/market-data/ingest`
- [ ] `nssm install IUFMarketAgent "C:\Python311\python.exe" "C:\iuf-trading-room\services\market-agent\src\agent\main.py"`
- [ ] `nssm set IUFMarketAgent AppStdout C:\logs\market-agent-stdout.log`
- [ ] `nssm set IUFMarketAgent AppStderr C:\logs\market-agent-stderr.log`
- [ ] `nssm start IUFMarketAgent`

---

## 6. KGI Quote Smoke (Phase 0 equivalent on EC2)

跑 `services/market-agent/scripts/phase0_smoke_ec2.py`（Lane D 寫）：

1. KGI login
2. quote subscribe 2330
3. 收 ≥ 10 ticks within 30s
4. tick → push to `IUF_INGEST_URL` with HMAC
5. cloud 端確認 Redis 有 `quote:2330`

PASS 標準：(a) login 成功 (b) quote 收到 (c) cloud Redis 有對應 key (d) 0 KGI native crash (e) zero secret in logs

---

## 7. KGI License U2 Question

**Status**: BLOCKED on 楊董 ask broker

需問 KGI ops:
1. 同一 person_id 是否允許 multi-host SDK 連線？
2. 若 EC2 Token 切換，當前個人 PC 那邊會被踢嗎？
3. 切到 EC2 production 後，個人 PC 是否需要 NSSM stop？

若 U2 = 單機綁定 → EC2 切換時要協調 cutover 時間（個人 PC stop → EC2 start）。

---

## 8. Cost Monitoring

- [ ] AWS Budget alert：USD 50/月 hit warn
- [ ] AWS Budget alert：USD 100/月 hit hard stop
- [ ] CloudWatch metric：CPU > 80% 連續 5 min 警報
- [ ] CloudWatch metric：NetworkOut > 10 GB/day 警報
- [ ] Spike 結束 → `aws ec2 stop-instances --instance-ids <id>` 不收 instance hour，只收 EBS

---

## 9. Stop-line check

- ✅ No public 8787 inbound
- ✅ RDP 限 IP /32
- ✅ KGI SDK 只在 EC2 跑，apps/api 不 import
- ✅ HMAC secret 走 Windows Credential Manager DPAPI，不入 repo
- ✅ /order/create 路徑不在 Market Agent scope（只 quote/tick read + push）
- ✅ kill-switch ARMED 不動
- ✅ TradingView 不准 — 用 FinMind + KGI quote
- ✅ Tailscale 只 ops backdoor，不走 production data path

---

## 10. C2 Gate（楊董執行）

楊董需做：
1. Review 本 runbook
2. ACK 後給我家用 IP /32（不入 chat — 寫 Windows local file 後我用 placeholder `<OPERATOR_HOME_IP>` 取代）
3. AWS CLI 跑 §4 dry-run（profile `elva-iuf` 對到 027903151493）
4. RDP 進去後跑 §5 install
5. 跑 §6 phase0 smoke
6. 確認 PASS → 留 instance 起來；FAIL → 寫 evidence + stop instance

**Status**: PLAN COMPLETE. C1 done. Awaiting 楊董 review → C2 execution.

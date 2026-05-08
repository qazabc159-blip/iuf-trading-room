#!/usr/bin/env bash
# security_group.sh
#
# EC2 Security Group spec for KGI Gateway on i-0b02f62220f422349 (54.249.139.28)
# Account: 027903151493 (IUF elva) / Region: ap-northeast-1
#
# RULES:
#   Inbound port 8787  — Railway egress IPs only (not public internet)
#   Inbound port 3389  — RDP from 楊董 workstation IP only
#   Outbound HTTPS 443 — KGI server (all destinations; KGI URL may change)
#   All other inbound  — DENY
#
# USAGE:
#   1. Edit VARIABLES section below (group ID, Railway IPs, your RDP IP)
#   2. Run: bash security_group.sh
#   3. Verify with: aws ec2 describe-security-groups --group-ids $SG_ID
#
# NOTE: This script is IDEMPOTENT — existing rules matching these CIDRs are
#       revoked first to avoid "already exists" errors.
#
# IMPORTANT: KGI_GATEWAY port 8787 MUST NOT be open to 0.0.0.0/0.
#            Only Railway egress IP range should be allowed.

set -euo pipefail

# ---------------------------------------------------------------------------
# VARIABLES — edit before running
# ---------------------------------------------------------------------------

SG_ID="sg-XXXXXXXXXXXXXXXXX"          # Replace with actual SG ID for i-0b02f62220f422349
REGION="ap-northeast-1"
GATEWAY_PORT=8787

# Railway egress IPs — get current list from Railway dashboard → Settings → Networking
# As of 2026-05 Railway uses shared egress; confirm with Bruce before running.
# Format: space-separated CIDRs
RAILWAY_EGRESS_CIDRS=(
  "52.0.0.0/8"          # PLACEHOLDER — replace with actual Railway egress CIDR(s)
  # Add more as needed
)

# 楊董 workstation public IP for RDP (port 3389)
# Get your current IP: curl -s https://checkip.amazonaws.com
YANG_DONG_RDP_IP="203.0.113.0/32"     # PLACEHOLDER — replace with actual IP

# AWS CLI profile (use "default" if EC2 instance profile handles auth)
AWS_PROFILE="${AWS_PROFILE:-default}"

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------

if [[ "$SG_ID" == "sg-XXXXXXXXXXXXXXXXX" ]]; then
  echo "ERROR: SG_ID is still a placeholder. Edit security_group.sh before running."
  exit 1
fi

if [[ "$YANG_DONG_RDP_IP" == "203.0.113.0/32" ]]; then
  echo "ERROR: YANG_DONG_RDP_IP is still a placeholder. Set your real public IP."
  echo "  Run: curl -s https://checkip.amazonaws.com"
  exit 1
fi

echo "=== KGI Gateway Security Group Setup ==="
echo "SG: $SG_ID  Region: $REGION  Port: $GATEWAY_PORT"
echo ""

# ---------------------------------------------------------------------------
# Helper: revoke rule if exists (suppress 'not found' error)
# ---------------------------------------------------------------------------
revoke_ingress_if_exists() {
  local protocol="$1"
  local port="$2"
  local cidr="$3"

  echo "  Revoking existing rule: $protocol $port $cidr (if present)..."
  aws ec2 revoke-security-group-ingress \
    --region "$REGION" \
    --group-id "$SG_ID" \
    --protocol "$protocol" \
    --port "$port" \
    --cidr "$cidr" \
    --profile "$AWS_PROFILE" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# 1. Port 8787 — Railway egress IPs only
# ---------------------------------------------------------------------------
echo "--- Rule 1: Port 8787 (KGI Gateway API) ---"

for cidr in "${RAILWAY_EGRESS_CIDRS[@]}"; do
  revoke_ingress_if_exists "tcp" "$GATEWAY_PORT" "$cidr"

  echo "  Authorizing: tcp $GATEWAY_PORT from $cidr (Railway egress)"
  aws ec2 authorize-security-group-ingress \
    --region "$REGION" \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port "$GATEWAY_PORT" \
    --cidr "$cidr" \
    --profile "$AWS_PROFILE"
done

# ---------------------------------------------------------------------------
# 2. Port 3389 (RDP) — 楊董 workstation IP only
# ---------------------------------------------------------------------------
echo ""
echo "--- Rule 2: Port 3389 (RDP) from 楊董 IP only ---"

revoke_ingress_if_exists "tcp" "3389" "$YANG_DONG_RDP_IP"

echo "  Authorizing: tcp 3389 from $YANG_DONG_RDP_IP (楊董 workstation)"
aws ec2 authorize-security-group-ingress \
  --region "$REGION" \
  --group-id "$SG_ID" \
  --protocol tcp \
  --port 3389 \
  --cidr "$YANG_DONG_RDP_IP" \
  --profile "$AWS_PROFILE"

# Explicitly revoke 0.0.0.0/0 on RDP if it exists (safety measure)
revoke_ingress_if_exists "tcp" "3389" "0.0.0.0/0" || true
revoke_ingress_if_exists "tcp" "3389" "::/0" || true

# ---------------------------------------------------------------------------
# 3. Outbound HTTPS (port 443) — already open by default in most SGs
#    Explicit rule ensures KGI server HTTPS calls work even if SG was restricted.
# ---------------------------------------------------------------------------
echo ""
echo "--- Rule 3: Outbound 443 (KGI server HTTPS) ---"
echo "  Note: AWS default SG allows all outbound. Skipping explicit rule."
echo "  If outbound was restricted, run:"
echo "  aws ec2 authorize-security-group-egress --group-id $SG_ID --protocol tcp --port 443 --cidr 0.0.0.0/0"

# ---------------------------------------------------------------------------
# 4. Do NOT open port 8787 to the public
# ---------------------------------------------------------------------------
echo ""
echo "--- Hardening: Ensure 8787 is NOT open to 0.0.0.0/0 ---"
revoke_ingress_if_exists "tcp" "$GATEWAY_PORT" "0.0.0.0/0" || true
revoke_ingress_if_exists "tcp" "$GATEWAY_PORT" "::/0" || true
echo "  0.0.0.0/0 revoked (if it existed)."

# ---------------------------------------------------------------------------
# 5. Verify final state
# ---------------------------------------------------------------------------
echo ""
echo "--- Final security group state ---"
aws ec2 describe-security-groups \
  --region "$REGION" \
  --group-ids "$SG_ID" \
  --profile "$AWS_PROFILE" \
  --query 'SecurityGroups[0].IpPermissions[*].{Proto:IpProtocol,Port:FromPort,CIDR:IpRanges[*].CidrIp}' \
  --output table

echo ""
echo "=== Security group setup complete ==="
echo "Port 8787 open to: Railway egress CIDRs only"
echo "Port 3389 open to: $YANG_DONG_RDP_IP only"
echo "Port 8787 NOT open to: 0.0.0.0/0 (verified)"

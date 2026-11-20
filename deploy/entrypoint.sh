#!/bin/sh
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Container entrypoint for the OpenShell console image.
#
# The console never speaks gRPC itself: it drives the `openshell` CLI, which
# needs the gateway registered under a name plus that gateway's client mTLS
# material on disk. This script stages the secret mounted by the Deployment,
# registers the gateway (idempotently), proves the session works, and only then
# hands over to the bridge — so a missing/mismatched credential fails the pod
# instead of surfacing as a confusing red console.
set -eu

GW_NAME="${GATEWAY_NAME:-openshell}"
GW_ENDPOINT="${GATEWAY_ENDPOINT:?GATEWAY_ENDPOINT must be set, e.g. https://openshell.openshell.svc.cluster.local:8080}"
GW_TLS_DIR="${GATEWAY_TLS_DIR:-/secrets/gateway-mtls}"

export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/config}"
export OPENSHELL_BIN="${OPENSHELL_BIN:-/usr/local/bin/openshell}"

# Optional: accept the gateway's self-signed certificate chain. Off by default —
# set GATEWAY_INSECURE=1 only when the server SAN cannot be made to match.
if [ "${GATEWAY_INSECURE:-0}" = "1" ]; then
  export OPENSHELL_GATEWAY_INSECURE=1
fi

CONFIG_DIR="$XDG_CONFIG_HOME/openshell"
mkdir -p "$CONFIG_DIR"

log() { printf '[console-entrypoint] %s\n' "$*" >&2; }

# Bound every CLI call: outside the cluster the gateway DNS name cannot resolve,
# and musl's resolver retries for tens of seconds. A slow gateway must not stop
# the console from serving. `timeout` is busybox/coreutils in both bases.
run_bounded() {
  limit=$1
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$limit" "$@"
  else
    "$@"
  fi
}

# --- 1. stage the gateway's client certificate -------------------------------
# `openshell gateway add --local` looks for
#   $XDG_CONFIG_HOME/openshell/gateways/<name>/mtls/{ca.crt,tls.crt,tls.key}
# The helm chart issues exactly those three keys in the client TLS Secret.
if [ -f "$GW_TLS_DIR/tls.crt" ] && [ -f "$GW_TLS_DIR/tls.key" ]; then
  if [ ! -f "$GW_TLS_DIR/ca.crt" ]; then
    log "tls.crt/tls.key found but ca.crt is missing in $GW_TLS_DIR"
    exit 1
  fi
  TLS_DEST="$CONFIG_DIR/gateways/$GW_NAME/mtls"
  mkdir -p "$TLS_DEST"
  cp -f "$GW_TLS_DIR/ca.crt" "$GW_TLS_DIR/tls.crt" "$GW_TLS_DIR/tls.key" "$TLS_DEST/"
  chmod 0600 "$TLS_DEST/tls.key"
  log "staged client certificate for '$GW_NAME' from $GW_TLS_DIR"
  MTLS=1
else
  log "no client certificate in $GW_TLS_DIR — registering '$GW_NAME' as a plaintext/edge gateway"
  MTLS=0
fi

# --- 2. register the gateway -------------------------------------------------
# `gateway add` writes the registration BEFORE it probes reachability, so a
# bounded call that times out (unresolvable cluster DNS when running the image
# outside Kubernetes, or a handshake against a gateway that is still starting)
# still leaves the gateway registered. Trust the registry, not the exit code.
if [ "$MTLS" = "1" ]; then
  # `--local` marks this as a directly reachable mTLS gateway (the certs are
  # staged above), as opposed to `--remote` (tunnelled over SSH).
  run_bounded 10 "$OPENSHELL_BIN" gateway add --local "$GW_ENDPOINT" --name "$GW_NAME" >/dev/null 2>&1 || true
else
  run_bounded 10 "$OPENSHELL_BIN" gateway add "$GW_ENDPOINT" --name "$GW_NAME" >/dev/null 2>&1 || true
fi

if ! run_bounded 10 "$OPENSHELL_BIN" gateway list -o json 2>/dev/null | grep -q "\"$GW_NAME\""; then
  log "ERROR: gateway '$GW_NAME' is not registered at $GW_ENDPOINT"
  exit 1
fi
run_bounded 10 "$OPENSHELL_BIN" gateway select "$GW_NAME" >/dev/null 2>&1 || true
export OPENSHELL_GATEWAY="$GW_NAME"

# --- 3. report the session before serving traffic ----------------------------
if STATUS=$(run_bounded 10 "$OPENSHELL_BIN" --gateway "$GW_NAME" status -o json 2>/dev/null); then
  log "gateway '$GW_NAME' reachable: $(printf '%s' "$STATUS" | tr -d '\n' | cut -c1-160)"
else
  # Do not crash-loop on a transiently unreachable gateway: the console is
  # readable without it and shows the connection error itself. REQUIRE_GATEWAY
  # turns this into a hard failure when the deployment wants one.
  log "WARNING: gateway '$GW_NAME' did not answer at $GW_ENDPOINT — the console starts anyway and shows the error"
  if [ "${REQUIRE_GATEWAY:-0}" = "1" ]; then
    log "REQUIRE_GATEWAY=1 — exiting"
    exit 1
  fi
fi

# --- 4. hand over ------------------------------------------------------------
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node server/index.ts

# Deploying the console in Kubernetes (production auth)

The console bridge is designed to run **in the same namespace as the OpenShell
gateway**: it shells out to the `openshell` CLI, which talks to the gateway over
gRPC + mTLS. In-cluster that means mounting the CLI's credentials from a Secret
instead of relying on a developer's `~/.config/openshell`.

The historic "local = loopback, no login" behaviour is a **development
convenience only**. In production every caller presents a credential:

| Caller | Path | What proves identity |
| --- | --- | --- |
| Human operator | Microsoft Entra ID device code | tenant sign-in + MFA / conditional access; app roles gate admin |
| Human operator | OIDC password grant (`OPENSHELL_UI_AUTH=oidc`) | Keycloak realm credentials; realm roles gate admin |
| Operator / bot / CI | local mTLS | client certificate chaining to `OPENSHELL_UI_TLS_CLIENT_CA`; CN = identity, admin role |
| Operator / bot / CI | local token | `OPENSHELL_UI_LOCAL_TOKEN_FILE` (Secret); constant-time check, rate limited, admin role |

The welcome page renders only the configured paths. Anonymous access is refused
unless *all* of: mode `local`, loopback bind, no local credential, no
`OPENSHELL_UI_REQUIRE_AUTH`. A non-loopback bind with no credential path
**refuses to start**.

---

## 0. Image

```bash
docker build -t <your-registry>/openshell-ui:<tag> .   # multi-arch: amd64/arm64
docker push <your-registry>/openshell-ui:<tag>
```

The image builds the web bundle, downloads the checksum-verified OpenShell CLI
(static musl binary, `OPENSHELL_VERSION` build-arg, default 0.1.8), and runs the
bridge as non-root `console` on Node 22 with a loopback healthcheck. It binds
`0.0.0.0`, so **a credential path is mandatory** — the fail-closed check refuses
to start otherwise. Gateway CLI credentials mount at
`/home/console/.config/openshell` (or point `XDG_CONFIG_HOME` at your mount).

## 1. Topology

```text
namespace: openshell
┌────────────────────────────┐        ┌──────────────────────────┐
│ console (Deployment, 1 rep)│        │ openshell gateway        │
│  bridge :8787 (https)      │─mTLS──▶│  gRPC :443 / :17670      │
│  CLI creds: Secret mount   │        │  server cert: same CA    │
└─────────────▲──────────────┘        └──────────────────────────┘
              │ https (server cert: cert-manager)
              │ client cert (operators) / session cookie (humans)
        Ingress / LoadBalancer
```

- **One replica.** Sessions and PTY terminal state are in-memory; scale by
  adding consoles per team/namespace, not replicas behind a round-robin Service.
  (If you must run >1 replica, pin sessions with cookie-based affinity and accept
  that terminal reconnects land on a different pod.)
- **NetworkPolicy**: ingress to the console only from the ingress controller /
  operator CIDR; egress from the console only to the gateway Service and to your
  IdP (login.microsoftonline.com / Keycloak) for token endpoints.

## 2. Secrets and certificates

```yaml
# operator token (bot / break-glass access)
apiVersion: v1
kind: Secret
metadata: { name: console-operator-token, namespace: openshell }
stringData:
  token: <generate: openssl rand -base64 32>
---
# CLI mTLS credentials for the gateway (same material the CLI uses locally)
apiVersion: v1
kind: Secret
metadata: { name: openshell-cli-creds, namespace: openshell }
data:
  # base64 of the CLI config dir contents (client cert/key, gateway metadata)
  config.yaml: <...>
---
# server TLS + client CA via cert-manager
apiVersion: cert-manager.io/v1
kind: Certificate
metadata: { name: console-tls, namespace: openshell }
spec:
  secretName: console-tls
  dnsNames: [console.openshell.example.com]
  issuerRef: { name: letsencrypt-prod, kind: ClusterIssuer }
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata: { name: console-client-ca, namespace: openshell }
spec:
  secretName: console-client-ca
  isCA: true
  commonName: openshell-console-clients
  issuerRef: { name: selfsigned, kind: ClusterIssuer }
# issue operator client certs from this CA (cert-manager Certificate with
# usages: [client auth], or your PKI); distribute cert+key to operators/bots.
```

```yaml
# OIDC issuer allowlist (non-secret): one entry per realm/IdP your operators
# use. `Display Name=url` gives the sign-in screen a friendly label; a single
# entry removes the dropdown entirely. All listed issuers must accept the
# configured client id (true for Keycloak realms sharing a client).
apiVersion: v1
kind: ConfigMap
metadata: { name: console-oidc, namespace: openshell }
data:
  issuers: "Production=https://keycloak.example.com/realms/prod"
  clientId: openshell-console
```

## 2b. Obtaining the gateway mTLS credentials

The bridge never talks to the gateway itself — it shells out to the `openshell` CLI, and
**the CLI's client certificate is the gateway identity**. Those credentials live in the CLI
config directory, per gateway:

```text
~/.config/openshell/                      # or $XDG_CONFIG_HOME/openshell
├── active_gateway                        # name of the selected gateway
└── gateways/<name>/
    ├── metadata.json                     # endpoint, auth_mode: mtls
    └── mtls/
        ├── ca.crt                        # gateway CA (CN=openshell-ca, O=openshell)
        ├── tls.crt                       # client cert (CN=openshell-client, OU=openshell-user)
        └── tls.key                       # client key (0600)
```

**How they are provisioned.** A local gateway (`openshell gateway add --local`, gateway
running in Docker/VM on the machine) generates this PKI and writes the client credentials
into the CLI config directory itself. For remote/cluster gateways the certificates must
already exist in the gateway config directory — i.e. the gateway deployment provisions its
CA and client cert, and an administrator distributes the client pair to operators
(`openshell gateway add --remote <ssh-dest>` registers against them). There is no
"download cert" API: possession of the client pair *is* the gateway authorization, so treat
`tls.key` like a private key everywhere it travels.

**Into Kubernetes.** Extract from a machine where the CLI already works against the target
gateway (in-cluster: from the gateway pod's own config dir):

```bash
G=~/.config/openshell/gateways/openshell
kubectl create secret generic openshell-cli-creds -n openshell \
  --from-file=ca.crt=$G/mtls/ca.crt \
  --from-file=tls.crt=$G/mtls/tls.crt \
  --from-file=tls.key=$G/mtls/tls.key \
  --from-file=metadata.json=$G/metadata.json \
  --from-file=active_gateway=~/.config/openshell/active_gateway
```

Mount it at the console pod's CLI config path (the Deployment in §3 mounts it at
`/cli-config/openshell` with `XDG_CONFIG_HOME=/cli-config`; the default non-root home is
`/home/console`, so `/home/console/.config/openshell` works without the env). The bridge
then runs every `openshell` command with that gateway identity — exactly like your laptop.

**Optional: one PKI for gateway and console.** The gateway's `ca.crt` can also serve as the
console's `OPENSHELL_UI_TLS_CLIENT_CA`: anyone holding a gateway client certificate then
authenticates to the console via mTLS with the cert CN as identity (e.g. `openshell-client`),
no separate operator PKI needed. Issue the console *server* certificate from the same CA
(cert-manager `Certificate` with a CA issuer, or openssl with proper SANs) so clients that
trust the gateway CA also trust the console endpoint. Trust implication: gateway access and
console operator access become the same privilege domain — appropriate for a single-team
namespace, not for mixed-trust clusters. For distinct domains keep separate CAs (the
`console-client-ca` Certificate in §2).

## 3. Deployment wiring

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: console, namespace: openshell }
spec:
  replicas: 1
  selector: { matchLabels: { app: console } }
  template:
    metadata: { labels: { app: console } }
    spec:
      containers:
        - name: console
          image: <your-registry>/openshell-ui:<tag>   # node >=22.6 + openshell CLI + dist/
          ports: [{ containerPort: 8787 }]
          env:
            - { name: OPENSHELL_UI_HOST, value: 0.0.0.0 }
            # public origin for OIDC redirect URIs (must be registered at the
            # IdP: <origin>/api/auth/oidc/callback)
            - { name: OPENSHELL_UI_PUBLIC_URL, value: https://console.openshell.example.com }
            - { name: OPENSHELL_UI_AUTH, value: oidc }          # humans: OIDC/Entra
            # issuer allowlist from a ConfigMap — fixed at deploy time, never
            # user-supplied (the password grant runs server-side against it).
            # One entry → the sign-in screen shows it as a label, no dropdown.
            - name: OPENSHELL_UI_OIDC_ISSUERS
              valueFrom: { configMapKeyRef: { name: console-oidc, key: issuers } }
            - name: OPENSHELL_UI_OIDC_CLIENT_ID
              valueFrom: { configMapKeyRef: { name: console-oidc, key: clientId } }
            - { name: OPENSHELL_UI_ENTRA_TENANT, value: <tenant-id> }
            - { name: OPENSHELL_UI_ENTRA_CLIENT_ID, value: <client-id> }
            - { name: OPENSHELL_UI_TLS_CERT, value: /tls/tls.crt }
            - { name: OPENSHELL_UI_TLS_KEY, value: /tls/tls.key }
            - { name: OPENSHELL_UI_TLS_CLIENT_CA, value: /client-ca/ca.crt }
            - { name: OPENSHELL_UI_LOCAL_TOKEN_FILE, value: /operator-token/token }
            - { name: XDG_CONFIG_HOME, value: /cli-config }     # CLI creds mount point
          volumeMounts:
            - { name: tls, mountPath: /tls, readOnly: true }
            - { name: client-ca, mountPath: /client-ca, readOnly: true }
            - { name: operator-token, mountPath: /operator-token, readOnly: true }
            - { name: cli-creds, mountPath: /cli-config/openshell, readOnly: true }
          readinessProbe:
            httpGet: { path: /api/auth/config, port: 8787, scheme: HTTPS }
      volumes:
        - { name: tls, secret: { secretName: console-tls } }
        - { name: client-ca, secret: { secretName: console-client-ca } }
        - { name: operator-token, secret: { secretName: console-operator-token } }
        - { name: cli-creds, secret: { secretName: openshell-cli-creds } }
```

Notes:

- `OPENSHELL_UI_AUTH=oidc` + Entra env gives humans both sign-in cards; the token
  and client CA add the local operator card. Drop any of them and its card
  disappears from the welcome page.
- **Register the OIDC callback at each IdP**: `<OPENSHELL_UI_PUBLIC_URL>/api/auth/oidc/callback`
  as a public-client redirect URI (Entra app registration) / valid redirect URI
  (Keycloak client). `scripts/entra-setup.mjs` registers the local dev origins;
  production origins must be added explicitly. Sign-in is authorization code +
  PKCE with server-side JWKS token verification — no client secret anywhere.
- Token and CA are read **at startup**: rotate Secrets then
  `kubectl rollout restart deployment/console`.
- mTLS sessions live as long as the certificate is presented; revocation =
  reissue the CA / remove the client cert (the bridge re-verifies per request).
- The bridge logs auth events (`[auth] …`) to stdout — ship them with your log
  pipeline. Tokens and certificates are never logged.
- Cookies are `HttpOnly; SameSite=Lax; Secure` under TLS; HSTS is set. Keep the
  Service/Ingress TLS-passthrough or re-encrypt to the pod — terminating TLS at
  the ingress **without** re-encryption loses client-certificate verification.

## 4. Verifying a deployment

```bash
# anonymous must fail
curl -s https://console…/api/sandboxes            # → 401
# operator token
curl -s -X POST https://console…/api/auth/local \
  -H 'content-type: application/json' -d '{"token":"…"}'   # → session cookie, admin
# mTLS
curl -s --cacert ca.crt --cert operator.crt --key operator.key \
  https://console…/api/auth/me                    # → user = cert CN, admin
# human: welcome page → Entra device code (MFA per tenant policy)
```
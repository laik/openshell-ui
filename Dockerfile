# syntax=docker/dockerfile:1
# OpenShell Console — production image.
#
# Multi-stage: build the web bundle with Node, fetch the checksum-verified
# OpenShell CLI (static musl binary) for the target architecture, then run the
# TypeScript bridge natively on Node >= 22.6 as a non-root user.
#
# The bridge binds 0.0.0.0 in-container, so the fail-closed auth invariant
# applies: run with a credential path configured (OIDC / Entra / token / mTLS),
# e.g.
#   docker run -p 8787:8787 \
#     -e OPENSHELL_UI_AUTH=oidc \
#     -e OPENSHELL_UI_ENTRA_TENANT=… -e OPENSHELL_UI_ENTRA_CLIENT_ID=… \
#     -e OPENSHELL_UI_LOCAL_TOKEN_FILE=/run/secrets/operator-token \
#     openshell-console

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM alpine:3.21 AS cli
ARG OPENSHELL_VERSION=0.1.8
RUN apk add --no-cache curl tar
# uname -m works on both the legacy builder and BuildKit (and under qemu for
# cross-platform builds); TARGETARCH is BuildKit-only.
RUN set -eux; \
    A="$(uname -m)"; \
    case "$A" in \
      x86_64|aarch64) ;; \
      *) echo "unsupported architecture: $A" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/NVIDIA/OpenShell/releases/download/v${OPENSHELL_VERSION}"; \
    curl -fsSL -o /tmp/os.tar.gz "$base/openshell-${A}-unknown-linux-musl.tar.gz"; \
    curl -fsSL -o /tmp/sums.txt "$base/openshell-checksums-sha256.txt"; \
    grep "openshell-${A}-unknown-linux-musl.tar.gz" /tmp/sums.txt \
      | sed "s|openshell-${A}-unknown-linux-musl.tar.gz|/tmp/os.tar.gz|" \
      | sha256sum -c -; \
    mkdir -p /cli; \
    tar -xzf /tmp/os.tar.gz -C /cli; \
    chmod 0755 /cli/openshell

FROM node:22-alpine
RUN addgroup -S console && adduser -S console -G console
WORKDIR /app
ENV NODE_ENV=production \
    OPENSHELL_UI_HOST=0.0.0.0 \
    OPENSHELL_UI_PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY --from=cli /cli/openshell /usr/local/bin/openshell
USER console
EXPOSE 8787
# Loopback self-check; TLS deployments use a self-signed/cluster cert, so cert
# verification is disabled for this probe only (never for real requests).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';const p=process.env.OPENSHELL_UI_PORT||8787;fetch('http://127.0.0.1:'+p+'/api/auth/config').then(r=>process.exit(r.ok?0:1)).catch(()=>fetch('https://127.0.0.1:'+p+'/api/auth/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1)))"
ENTRYPOINT ["node", "server/index.ts"]
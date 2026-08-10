FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS configurator-builder

ARG TARGETARCH
RUN case "$TARGETARCH" in arm64|amd64) ;; *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; esac

WORKDIR /build

COPY web-configurator ./web-configurator
COPY tools/prepare-web-configurator.js ./tools/prepare-web-configurator.js

ENV UCVR_WEB_CONFIGURATOR_SOURCE_DIR=/build/web-configurator \
    UCVR_WEB_CONFIGURATOR_DIR=/build/web-configurator-build \
    UCVR_WEB_CONFIGURATOR_SOURCE_OUTPUT_DIR=/build/web-configurator-source

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git gzip tar \
    && node tools/prepare-web-configurator.js \
    && rm -rf /var/lib/apt/lists/* /build/web-configurator/node_modules /build/web-configurator/dist

FROM node:22-bookworm-slim

ARG TARGETARCH
RUN case "$TARGETARCH" in arm64|amd64) ;; *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; esac

WORKDIR /app

COPY package.json ./
COPY launcher.js ./
COPY src ./src
COPY public ./public
COPY assets ./assets
COPY tools ./tools
COPY examples ./examples
COPY docker-entrypoint.sh /usr/local/bin/ucvr-entrypoint
COPY --from=configurator-builder /build/web-configurator-build ./web-configurator-build
COPY --from=configurator-builder /build/web-configurator-source ./web-configurator-source

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bluez ca-certificates docker.io fuse-overlayfs git gosu iproute2 iptables iw libcap2-bin network-manager rfkill tar usbutils util-linux \
    && if [ "$TARGETARCH" = "amd64" ]; then \
         dpkg --add-architecture arm64; \
         apt-get update; \
         apt-get install -y --no-install-recommends qemu-user-static libc6-arm64-cross libgcc-s1-arm64-cross libstdc++6-arm64-cross zlib1g:arm64; \
         cp /usr/bin/qemu-aarch64-static /usr/local/bin/qemu-aarch64-static; \
         chmod 0755 /usr/local/bin/qemu-aarch64-static; \
         install -d /usr/aarch64-linux-gnu/lib; \
         cp -a /lib/aarch64-linux-gnu/libz.so.1* /usr/aarch64-linux-gnu/lib/; \
         test -e /usr/aarch64-linux-gnu/lib/libz.so.1; \
         apt-get purge -y qemu-user-static; \
       fi \
    && rm -rf /var/lib/apt/lists/* \
    && chmod 0755 /usr/local/bin/ucvr-entrypoint \
    && setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(command -v node)")" \
    && getcap "$(readlink -f "$(command -v node)")" | grep -q 'cap_net_bind_service=ep' \
    && mkdir -p /data \
    && chown -R node:node /app /data

ENV NODE_ENV=production \
    UCVR_DATA_DIR=/data \
    UCVR_HOST=0.0.0.0 \
    UCVR_REST_PORT=11090 \
    UCVR_INTEGRATION_PORT_START=11091 \
    UCVR_REQUIRE_ARM64=false \
    UCVR_ARM64_EMULATOR=/usr/local/bin/qemu-aarch64-static \
    UCVR_ARM64_LD_PREFIX=/usr/aarch64-linux-gnu \
    UCVR_DIND=true \
    UCVR_DIND_DATA_ROOT=/data/docker \
    UCVR_DIND_STORAGE_DRIVER=overlay2 \
    UCVR_NATIVE_UID=1000 \
    UCVR_NATIVE_GID=1000 \
    DOCKER_HOST=unix:///var/run/docker.sock \
    UCVR_WEB_CONFIGURATOR_DIR=/app/web-configurator-build \
    UCVR_WEB_CONFIGURATOR_SOURCE_ARCHIVE_PATH=/app/web-configurator-source/web-configurator-2.3.3-unfoldedtools.8-source.tar.gz

EXPOSE 946 11090
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "tools/healthcheck.js"]

ENTRYPOINT ["ucvr-entrypoint"]
CMD ["node", "launcher.js"]

# syntax=docker/dockerfile:1.7
#
# ClamAV scanner image — its own container, never part of the worker's (docs/08b §21.7,
# 8B-I5.5; beta: deploy/import/compose.yaml). Build context: the repository root. Built right
# before each import, so the official signatures are fresh (B-035 L2; the runbook is L3):
#
#   docker compose -f deploy/import/compose.yaml build clamav
#
# * The ClamAV engine is the APPROVED one in deploy/clamav/engine.json (8B-I5.6, B-028): LTS
#   line 1.4, production 1.4.6. Pass the approved base image BY DIGEST as CLAMAV_BASE; the
#   default below names the same release. A signature refresh never changes the engine — an
#   engine upgrade is a separate, approved candidate (clamav-engine-candidate.yml).
# * The OFFICIAL ClamAV signatures (main, daily, bytecode) are downloaded HERE, at build time, by
#   freshclam from the official mirror — no third-party signatures. The running container
#   downloads nothing and has no internet egress.
# * The build records engine and signature versions in /usr/share/ipa/scanner-build.txt.
# * No credentials, no environment, no secrets. Unprivileged user, read-only root filesystem;
#   /tmp is a tmpfs (deploy/import/compose.yaml).

ARG CLAMAV_BASE=docker.io/clamav/clamav:1.4.6_base

FROM ${CLAMAV_BASE} AS signatures
USER root
RUN freshclam --foreground --stdout --show-progress=no --config-file=/etc/clamav/freshclam.conf \
 && test -s /var/lib/clamav/daily.cvd -o -s /var/lib/clamav/daily.cld \
 && test -s /var/lib/clamav/main.cvd -o -s /var/lib/clamav/main.cld \
 && mkdir -p /usr/share/ipa \
 && clamscan --version > /usr/share/ipa/scanner-build.txt \
 && date -u +%Y-%m-%dT%H:%M:%SZ >> /usr/share/ipa/scanner-build.txt

FROM ${CLAMAV_BASE}
USER root
COPY --from=signatures /var/lib/clamav/ /var/lib/clamav/
COPY --from=signatures /usr/share/ipa/ /usr/share/ipa/
COPY deploy/clamav/clamd.conf /etc/clamav/clamd.conf
RUN chmod -R a+rX,go-w /var/lib/clamav /etc/clamav /usr/share/ipa
LABEL org.opencontainers.image.title="ipa-clamav" \
      org.opencontainers.image.description="ClamAV (approved 1.4 LTS engine, deploy/clamav/engine.json) with official signatures baked in at build time"
USER 10001:10001
EXPOSE 3310
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 CMD ["clamdscan", "--config-file=/etc/clamav/clamd.conf", "--ping", "1"]
ENTRYPOINT ["clamd", "--foreground", "--config-file=/etc/clamav/clamd.conf"]

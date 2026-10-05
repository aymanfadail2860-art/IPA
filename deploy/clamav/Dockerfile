# syntax=docker/dockerfile:1.7
#
# ClamAV scanner image — its own ECS service, not part of the worker task (docs/08b §21.7,
# 8B-I5.5). Build context: the repository root. Built ONLY by the scheduled workflow
# .github/workflows/clamav-signatures.yml, never by hand for production:
#
#   docker build -f deploy/clamav/Dockerfile -t ipa-clamav:candidate .
#
# * Pinned ClamAV release (1.4.3, the LTS line). The official base image is resolved by digest
#   in the pipeline; the digest of the built image is what the ECS task definition references.
# * The OFFICIAL ClamAV signatures (main, daily, bytecode) are downloaded HERE, at build time, by
#   freshclam from the official mirror — no third-party signatures. The running container
#   downloads nothing and has no internet egress.
# * The build records engine and signature versions in /usr/share/ipa/scanner-build.txt.
# * No credentials, no environment, no secrets. Unprivileged user, read-only root filesystem;
#   /tmp is a task volume.

FROM docker.io/clamav/clamav:1.4.3_base AS signatures
USER root
RUN freshclam --foreground --stdout --show-progress=no --config-file=/etc/clamav/freshclam.conf \
 && test -s /var/lib/clamav/daily.cvd -o -s /var/lib/clamav/daily.cld \
 && test -s /var/lib/clamav/main.cvd -o -s /var/lib/clamav/main.cld \
 && mkdir -p /usr/share/ipa \
 && clamscan --version > /usr/share/ipa/scanner-build.txt \
 && date -u +%Y-%m-%dT%H:%M:%SZ >> /usr/share/ipa/scanner-build.txt

FROM docker.io/clamav/clamav:1.4.3_base
USER root
COPY --from=signatures /var/lib/clamav/ /var/lib/clamav/
COPY --from=signatures /usr/share/ipa/ /usr/share/ipa/
COPY deploy/clamav/clamd.conf /etc/clamav/clamd.conf
RUN chmod -R a+rX,go-w /var/lib/clamav /etc/clamav /usr/share/ipa
LABEL org.opencontainers.image.title="ipa-clamav" \
      org.opencontainers.image.description="ClamAV 1.4.3 with official signatures baked in at build time (8B-I5.5)"
USER 10001:10001
EXPOSE 3310
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 CMD ["clamdscan", "--config-file=/etc/clamav/clamd.conf", "--ping", "1"]
ENTRYPOINT ["clamd", "--foreground", "--config-file=/etc/clamav/clamd.conf"]

# syntax=docker/dockerfile:1.7
#
# ClamAV sidecar image for the ingestion worker (docs/08b §21.6). Build context: the repository
# root.
#
#   docker build -f deploy/clamav/Dockerfile -t ipa-clamav:<UTC timestamp> .
#
# * The signatures are downloaded HERE, at build time, by freshclam. The running container
#   downloads nothing and needs no network: it only receives bytes from the worker over
#   127.0.0.1:3310 and answers. Fresh signatures = a new image, built on a schedule (README.md).
# * No credentials, no environment, no secrets. Runs as an unprivileged user on a read-only root
#   filesystem; /tmp is a task volume (task definition).
# * Pin the base image's digest when the pipeline first builds it [AFKLARES].

FROM docker.io/clamav/clamav:1.4.3_base AS signatures
USER root
RUN freshclam --foreground --stdout --show-progress=no --config-file=/etc/clamav/freshclam.conf \
 && test -s /var/lib/clamav/daily.cvd -o -s /var/lib/clamav/daily.cld

FROM docker.io/clamav/clamav:1.4.3_base
USER root
COPY --from=signatures /var/lib/clamav/ /var/lib/clamav/
COPY deploy/clamav/clamd.conf /etc/clamav/clamd.conf
RUN chmod -R a+rX,go-w /var/lib/clamav /etc/clamav
USER 10001:10001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 CMD ["clamdscan", "--config-file=/etc/clamav/clamd.conf", "--ping", "1"]
ENTRYPOINT ["clamd", "--foreground", "--config-file=/etc/clamav/clamd.conf"]

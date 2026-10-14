#!/usr/bin/env bash
# Dokumentimport til Insurance Partners (beta L3). Runbook: docs/import-runbook.md.
#
#   ./deploy/import/ipa-import.sh forbered     byg scanner (friske signaturer) og image, kontrollér scanneren
#   ./deploy/import/ipa-import.sh produkter    vis produkt-id'er og dokumenttyper til importlisten
#   ./deploy/import/ipa-import.sh kontroller   kontrollér importlisten og filerne (ændrer intet)
#   ./deploy/import/ipa-import.sh importer     kontrollér scanneren, upload, scan og tekstudtræk, status
#   ./deploy/import/ipa-import.sh status       status og bevis for hver fil (også efter godkendelse)
#   ./deploy/import/ipa-import.sh stop         stop og fjern containerne
#
# The settings file (IPA_IMPORT_ENV_FILE, default ~/ipa-import/ipa-import.env) holds addresses and
# names only: it must be readable by the operator alone and may hold no password or key. The two
# passwords — the operator's own login and the worker's database role — are asked for here, kept
# only in this process's environment for the run, and never written anywhere.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$here/compose.yaml"
env_file="${IPA_IMPORT_ENV_FILE:-$HOME/ipa-import/ipa-import.env}"

die() { printf 'Fejl: %s\n' "$*" >&2; exit 1; }
say() { printf '\n== %s\n' "$*" >&2; }

command -v docker >/dev/null 2>&1 || die "Docker er ikke installeret eller ikke startet."
docker info >/dev/null 2>&1 || die "Docker kører ikke. Start Docker Desktop og prøv igen."
[ -f "$env_file" ] || die "Indstillingsfilen $env_file findes ikke (runbookens trin 2)."
mode="$(stat -c %a "$env_file" 2>/dev/null || stat -f %Lp "$env_file")"
case "$mode" in
  600 | 400) ;;
  *) die "Indstillingsfilen må kun kunne læses af dig. Kør: chmod 600 \"$env_file\"" ;;
esac
if grep -Eiq '^[[:space:]]*(export[[:space:]]+)?[A-Z0-9_]*(PASSWORD|SECRET|SERVICE_ROLE)[A-Z0-9_]*[[:space:]]*=' "$env_file"; then
  die "Indstillingsfilen må ikke indeholde adgangskoder eller hemmelige nøgler. Du bliver spurgt om dem."
fi

# The import runs as you, so it can read your folder and the reports belong to you.
IPA_IMPORT_UID="$(id -u)"
IPA_IMPORT_GID="$(id -g)"
export IPA_IMPORT_UID IPA_IMPORT_GID

dc() { docker compose --env-file "$env_file" -f "$compose_file" "$@"; }

ask() {
  local name="$1" prompt="$2" value
  if [ -z "${!name:-}" ]; then
    read -rsp "$prompt" value
    printf '\n' >&2
    [ -n "$value" ] || die "Ingen adgangskode angivet."
    export "$name=$value"
  fi
}

# docker compose reads every service's settings, also for steps that do not start the worker.
# Those steps pass a placeholder the worker would refuse (shorter than 16 characters), so the
# worker's real password is asked for only where the worker runs.
no_worker() { export IPA_WORKER_DB_PASSWORD="${IPA_WORKER_DB_PASSWORD:-ikke-brugt}"; }
no_import() { export IPA_IMPORT_PASSWORD="${IPA_IMPORT_PASSWORD:-}"; }

scanner_check() {
  say "Starter og kontrollerer scanneren (godkendt motor, signaturer under 8 timer, EICAR)"
  dc up -d --wait clamav || die "Scanneren startede ikke. Kør forbered igen."
  # In the worker's service: the only one that reaches the scanner (deploy/import/compose.yaml).
  dc run --rm -T --entrypoint node worker scripts/verify-clamav-scanner.ts --host clamav --port 3310 ||
    die "Scannerkontrollen fejlede. Kør forbered for at bygge scanneren med friske signaturer."
}

case "${1:-}" in
  forbered)
    no_worker
    no_import
    say "Bygger scanneren med friske officielle signaturer (uden cache)"
    dc build --no-cache clamav
    say "Bygger worker- og import-imaget"
    dc build worker
    scanner_check
    say "Klar. Næste trin: produkter / kontroller / importer."
    ;;
  produkter | kontroller | status)
    no_worker
    ask IPA_IMPORT_PASSWORD "Adgangskode til din IPA-konto: "
    dc run --rm import "$1"
    ;;
  importer)
    ask IPA_IMPORT_PASSWORD "Adgangskode til din IPA-konto: "
    ask IPA_WORKER_DB_PASSWORD "Workerens databaseadgangskode: "
    scanner_check
    say "Uploader til karantæne og registrerer"
    set +e
    dc run --rm import upload
    code=$?
    set -e
    [ "$code" -eq 1 ] && die "Importen kunne ikke køre (se ovenfor). Intet er sendt til scanning."
    say "Sikkerhedskontrol og tekstudtræk (workeren)"
    dc run --rm worker || die "Workeren stoppede med en fejl. Kør importer igen; intet publiceres automatisk."
    say "Status"
    dc run --rm import status
    ;;
  stop)
    no_worker
    no_import
    dc down --remove-orphans
    ;;
  *)
    sed -n '2,10p' "$0" >&2
    exit 1
    ;;
esac

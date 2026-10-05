# Supabase CA (offentligt certifikat, ingen hemmelighed)

Workeren kræver TLS med certifikatkontrol mod Supavisor (`IPA_WORKER_DB_SSL=verify-full`,
`docs/08b` §21.5). Supabases rodcertifikat hentes fra projektets *Database Settings → SSL
Configuration* og lægges her som `supabase-ca.crt`, før imaget bygges. Det er et offentligt
certifikat og må committes.

Filen findes ikke endnu, fordi produktionsprojektet ikke er oprettet [AFKLARES]. Uden den
starter workeren ikke i produktion (konfigurationen afviser en manglende CA-fil).

/**
 * ⚠ TEST STAND-IN — not a scanner. Speaks the clamd protocol (zVERSION, zINSTREAM) like the
 * ClamAV service, reports the approved engine with signatures from "now" and finds nothing.
 * Used only by src/tests/integration/import-docker.integration.test.ts for the part of the real
 * Docker run that needs FRESH signatures where the official mirror cannot be reached; the real
 * ClamAV container is tested in the same file. The database never sees it as anything but a
 * scanner reply; production refuses every scanner but the fixed ClamAV service.
 *
 * A file "delay-ms" next to this script delays each scan reply (to stop a worker mid-scan).
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:net";

const delay = () => {
  try {
    return Number(readFileSync(new URL("./delay-ms", import.meta.url), "utf8")) || 0;
  } catch {
    return 0;
  }
};

const clamdDate = (date) => {
  const utc = date.toUTCString();
  const pad = (n) => String(n).padStart(2, "0");
  return `${utc.slice(0, 3)} ${utc.slice(8, 11)} ${String(date.getUTCDate()).padStart(2, " ")} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${date.getUTCFullYear()}`;
};

createServer((socket) => {
  let buffer = Buffer.alloc(0);
  socket.on("error", () => {});
  socket.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);
    if (buffer.toString("latin1").startsWith("zVERSION\0")) return void socket.end(`ClamAV 1.4.6/99999/${clamdDate(new Date(Date.now() - 600_000))}\0`);
    if (buffer.length >= 14 && buffer.subarray(-4).readUInt32BE(0) === 0) setTimeout(() => socket.end("stream: OK\0"), delay());
  });
}).listen(3310, "0.0.0.0");

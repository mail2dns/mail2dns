#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";

// src/utils.ts
import readline from "readline";
var c = {
  green: (s) => `\x1B[32m${s}\x1B[0m`,
  red: (s) => `\x1B[31m${s}\x1B[0m`,
  yellow: (s) => `\x1B[33m${s}\x1B[0m`,
  dim: (s) => `\x1B[2m${s}\x1B[0m`
};
var log = {
  success: (msg) => console.log(c.green(msg)),
  error: (msg) => console.error(c.red(msg)),
  warn: (msg) => console.log(c.yellow(msg)),
  info: (msg) => console.log(msg),
  dim: (msg) => console.log(c.dim(msg))
};
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
async function confirm(question) {
  const answer = await ask(question);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}
async function resolveInputs(inputs8, argv) {
  const result = {};
  for (const input of inputs8) {
    let value = argv[input.flag];
    if (!value && input.env) value = process.env[input.env];
    if (!value) {
      if (input.optional) continue;
      if (input.instructions) log.dim(`
${input.instructions}`);
      value = await ask(`${input.name}: `);
    }
    if (!value) throw new Error(`${input.name} is required`);
    result[input.flag] = value;
  }
  return result;
}

// src/dns-modules/cloudflare.ts
var inputs = [
  {
    flag: "token",
    name: "Cloudflare API token",
    env: "CLOUDFLARE_API_TOKEN",
    instructions: "Create a token at https://dash.cloudflare.com/profile/api-tokens with Zone:DNS:Edit permissions"
  }
];
var BASE_URL = process.env.CLOUDFLARE_API_URL ?? "https://api.cloudflare.com/client/v4";
async function cfFetch(path, options, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers
    }
  });
  const data = await res.json();
  if (!data.success) {
    const msg = data.errors?.[0]?.message ?? "Unknown Cloudflare API error";
    throw new Error(`Cloudflare API error: ${msg}`);
  }
  return data.result;
}
async function getZoneId(domain, token) {
  const zones = await cfFetch(`/zones?name=${encodeURIComponent(domain)}&status=active`, {}, token);
  if (!zones || zones.length === 0) {
    throw new Error(`Zone not found for domain: ${domain}`);
  }
  return zones[0].id;
}
async function listDnsRecords(zoneId, token) {
  return cfFetch(`/zones/${zoneId}/dns_records?per_page=100`, {}, token);
}
async function deleteRecord(zoneId, recordId, token) {
  await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" }, token);
}
async function createRecord(zoneId, record, token) {
  const body = {
    type: record.type,
    name: record.name,
    content: record.content,
    ttl: record.ttl ?? 1
  };
  if (record.priority !== void 0) {
    body.priority = record.priority;
  }
  return cfFetch(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify(body)
  }, token);
}
function normalizeName(name, domain) {
  if (name === domain) return "@";
  if (name.endsWith(`.${domain}`)) return name.slice(0, -(domain.length + 1));
  return name;
}
function findConflicts(existing, records, domain, verificationPrefix) {
  const conflicts = [];
  for (const record of records) {
    const matches = existing.filter((e) => {
      const eName = normalizeName(e.name, domain);
      if (record.type === "MX" && e.type === "MX") return true;
      if (record.type === "TXT" && e.type === "TXT") {
        if (record.content.includes("v=spf1") && e.content.includes("v=spf1")) return true;
        if (verificationPrefix && record.content.includes(verificationPrefix) && e.content.includes(verificationPrefix)) return true;
        if (record.content.includes("v=DMARC1") && eName === record.name) return true;
      }
      if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) {
        if ((e.type === "CNAME" || e.type === "TXT") && eName === record.name) return true;
      }
      return false;
    });
    for (const m of matches) {
      if (!conflicts.find((c2) => c2.id === m.id)) {
        conflicts.push(m);
      }
    }
  }
  return conflicts;
}
function formatRecord(r, domain) {
  const name = normalizeName(r.name, domain);
  const priority = r.priority !== void 0 ? ` (priority ${r.priority})` : "";
  return `  [${r.type.padEnd(5)}] ${name} \u2192 ${r.content}${priority}`;
}
async function setupRecords({ domain, records, verificationPrefix, confirm: confirmFn }, { token }) {
  const confirmCmd = confirmFn ?? confirm;
  const zoneId = await getZoneId(domain, token);
  log.success(`Zone found: ${domain}`);
  const existing = await listDnsRecords(zoneId, token);
  const conflicts = findConflicts(existing, records, domain, verificationPrefix);
  if (conflicts.length > 0) {
    log.warn("\nThe following existing records will be removed:");
    for (const r of conflicts) {
      log.dim(formatRecord(r, domain));
    }
  } else {
    log.info("\nNo conflicting records found.");
  }
  log.info("\nThe following records will be created:");
  for (const r of records) {
    log.dim(formatRecord(r, domain));
  }
  console.log();
  const ok = await confirmCmd("Proceed? (y/N) ");
  if (!ok) {
    log.warn("Aborted.");
    return;
  }
  if (conflicts.length > 0) {
    for (const r of conflicts) {
      await deleteRecord(zoneId, r.id, token);
    }
    log.info(`
Removed ${conflicts.length} conflicting record${conflicts.length !== 1 ? "s" : ""}`);
  }
  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 };
  for (const record of records) {
    await createRecord(zoneId, record, token);
    if (verificationPrefix && record.content.includes(verificationPrefix)) created.verification++;
    else if (record.type === "MX") created.mx++;
    else if (record.content.includes("v=spf1")) created.spf++;
    else if (record.content.includes("v=DMARC1")) created.dmarc++;
    else if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) created.dkim++;
  }
  console.log();
  if (created.verification) log.success("Created TXT verification record");
  if (created.mx) log.success("Created MX records");
  if (created.spf) log.success("Created SPF record");
  if (created.dmarc) log.success("Created DMARC record");
  if (created.dkim) log.success("Created DKIM CNAME records");
  log.success("\nSetup complete.");
}

// src/dns-modules/godaddy.ts
var inputs2 = [
  {
    flag: "key",
    name: "GoDaddy API key",
    env: "GODADDY_API_KEY",
    instructions: "Create API credentials at https://developer.godaddy.com/keys"
  },
  {
    flag: "secret",
    name: "GoDaddy API secret",
    env: "GODADDY_API_SECRET"
  }
];
var BASE_URL2 = process.env.GODADDY_API_URL ?? "https://api.godaddy.com";
async function gdFetch(path, options, key, secret) {
  const res = await fetch(`${BASE_URL2}${path}`, {
    ...options,
    headers: {
      Authorization: `sso-key ${key}:${secret}`,
      "Content-Type": "application/json",
      ...options?.headers
    }
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`GoDaddy API error: ${data.message ?? res.statusText}`);
  }
  if (res.status === 204) return void 0;
  return res.json();
}
async function listRecords(domain, key, secret) {
  return gdFetch(`/v1/domains/${encodeURIComponent(domain)}/records`, {}, key, secret);
}
async function deleteRecords(domain, type, name, key, secret) {
  await gdFetch(
    `/v1/domains/${encodeURIComponent(domain)}/records/${type}/${encodeURIComponent(name)}`,
    { method: "DELETE" },
    key,
    secret
  );
}
async function addRecords(domain, records, key, secret) {
  await gdFetch(`/v1/domains/${encodeURIComponent(domain)}/records`, {
    method: "PATCH",
    body: JSON.stringify(records)
  }, key, secret);
}
function findConflicts2(existing, records, verificationPrefix) {
  const conflicts = [];
  function addConflict(type, name) {
    if (!conflicts.find((c2) => c2.type === type && c2.name === name)) {
      conflicts.push({ type, name });
    }
  }
  for (const record of records) {
    for (const e of existing) {
      if (record.type === "MX" && e.type === "MX") {
        addConflict(e.type, e.name);
      } else if (record.type === "TXT" && e.type === "TXT") {
        if (record.content.includes("v=spf1") && e.data.includes("v=spf1")) {
          addConflict(e.type, e.name);
        } else if (verificationPrefix && record.content.includes(verificationPrefix) && e.data.includes(verificationPrefix)) {
          addConflict(e.type, e.name);
        } else if (record.content.includes("v=DMARC1") && e.name === record.name) {
          addConflict(e.type, e.name);
        }
      } else if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) {
        if ((e.type === "CNAME" || e.type === "TXT") && e.name === record.name) {
          addConflict(e.type, e.name);
        }
      }
    }
  }
  return conflicts;
}
function toGdRecord(record) {
  const r = { type: record.type, name: record.name, data: record.content, ttl: record.ttl ?? 3600 };
  if (record.priority !== void 0) r.priority = record.priority;
  return r;
}
function formatRecord2(r) {
  const priority = r.priority !== void 0 ? ` (priority ${r.priority})` : "";
  return `  [${r.type.padEnd(5)}] ${r.name} \u2192 ${r.data}${priority}`;
}
async function setupRecords2({ domain, records, verificationPrefix, confirm: confirmFn }, { key, secret }) {
  const doConfirm = confirmFn ?? confirm;
  const existing = await listRecords(domain, key, secret);
  const conflictKeys = findConflicts2(existing, records, verificationPrefix);
  const conflictRecords = existing.filter((e) => conflictKeys.find((c2) => c2.type === e.type && c2.name === e.name));
  if (conflictRecords.length > 0) {
    log.warn("\nThe following existing records will be removed:");
    for (const r of conflictRecords) {
      log.dim(formatRecord2(r));
    }
  } else {
    log.info("\nNo conflicting records found.");
  }
  log.info("\nThe following records will be created:");
  for (const r of records) {
    log.dim(formatRecord2({ type: r.type, name: r.name, data: r.content, priority: r.priority }));
  }
  console.log();
  const ok = await doConfirm("Proceed? (y/N) ");
  if (!ok) {
    log.warn("Aborted.");
    return;
  }
  for (const { type, name } of conflictKeys) {
    await deleteRecords(domain, type, name, key, secret);
  }
  if (conflictKeys.length > 0) {
    log.info(`
Removed ${conflictKeys.length} conflicting record group${conflictKeys.length !== 1 ? "s" : ""}`);
  }
  await addRecords(domain, records.map(toGdRecord), key, secret);
  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 };
  for (const record of records) {
    if (verificationPrefix && record.content.includes(verificationPrefix)) created.verification++;
    else if (record.type === "MX") created.mx++;
    else if (record.content.includes("v=spf1")) created.spf++;
    else if (record.content.includes("v=DMARC1")) created.dmarc++;
    else if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) created.dkim++;
  }
  console.log();
  if (created.verification) log.success("Created TXT verification record");
  if (created.mx) log.success("Created MX records");
  if (created.spf) log.success("Created SPF record");
  if (created.dmarc) log.success("Created DMARC record");
  if (created.dkim) log.success("Created DKIM CNAME records");
  log.success("\nSetup complete.");
}

// src/dns-modules/digitalocean.ts
var inputs3 = [
  {
    flag: "token",
    name: "DigitalOcean API token",
    env: "DIGITALOCEAN_TOKEN",
    instructions: "Create a token at https://cloud.digitalocean.com/account/api/tokens with read and write scopes."
  }
];
var BASE_URL3 = process.env.DIGITALOCEAN_API_URL ?? "https://api.digitalocean.com/v2";
async function doFetch(path, options, token) {
  const res = await fetch(`${BASE_URL3}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers
    }
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`DigitalOcean API error: ${data.message ?? res.statusText}`);
  }
  if (res.status === 204) return void 0;
  return res.json();
}
async function checkDomainExists(domain, token) {
  await doFetch(`/domains/${domain}`, {}, token);
}
async function listRecords2(domain, token) {
  const data = await doFetch(`/domains/${domain}/records?per_page=200`, {}, token);
  return data.domain_records;
}
async function deleteRecord2(domain, id, token) {
  await doFetch(`/domains/${domain}/records/${id}`, { method: "DELETE" }, token);
}
async function createRecord2(domain, record, token) {
  const body = {
    type: record.type,
    name: record.name,
    data: record.content,
    ttl: record.ttl ?? 3600
  };
  if (record.priority !== void 0) body.priority = record.priority;
  const data = await doFetch(`/domains/${domain}/records`, {
    method: "POST",
    body: JSON.stringify(body)
  }, token);
  return data.domain_record;
}
function findConflicts3(existing, records, verificationPrefix) {
  const conflicts = [];
  for (const record of records) {
    const matches = existing.filter((e) => {
      if (record.type === "MX" && e.type === "MX") return true;
      if (record.type === "TXT" && e.type === "TXT") {
        if (record.content.includes("v=spf1") && e.data.includes("v=spf1")) return true;
        if (verificationPrefix && record.content.includes(verificationPrefix) && e.data.includes(verificationPrefix)) return true;
        if (record.content.includes("v=DMARC1") && e.name === record.name) return true;
      }
      if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) {
        if ((e.type === "CNAME" || e.type === "TXT") && e.name === record.name) return true;
      }
      return false;
    });
    for (const m of matches) {
      if (!conflicts.find((c2) => c2.id === m.id)) conflicts.push(m);
    }
  }
  return conflicts;
}
function formatRecord3(r) {
  const priority = r.priority !== void 0 ? ` (priority ${r.priority})` : "";
  return `  [${r.type.padEnd(5)}] ${r.name} \u2192 ${r.data}${priority}`;
}
async function setupRecords3({ domain, records, verificationPrefix, confirm: confirmFn }, { token }) {
  const confirm2 = confirmFn ?? confirm;
  await checkDomainExists(domain, token);
  log.success(`Domain found: ${domain}`);
  const existing = await listRecords2(domain, token);
  const conflicts = findConflicts3(existing, records, verificationPrefix);
  if (conflicts.length > 0) {
    log.warn("\nThe following existing records will be removed:");
    for (const r of conflicts) log.dim(formatRecord3(r));
  } else {
    log.info("\nNo conflicting records found.");
  }
  log.info("\nThe following records will be created:");
  for (const r of records) {
    log.dim(formatRecord3({ type: r.type, name: r.name, data: r.content, priority: r.priority }));
  }
  console.log();
  const ok = await confirm2("Proceed? (y/N) ");
  if (!ok) {
    log.warn("Aborted.");
    return;
  }
  if (conflicts.length > 0) {
    for (const r of conflicts) await deleteRecord2(domain, r.id, token);
    log.info(`
Removed ${conflicts.length} conflicting record${conflicts.length !== 1 ? "s" : ""}`);
  }
  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 };
  for (const record of records) {
    await createRecord2(domain, record, token);
    if (verificationPrefix && record.content.includes(verificationPrefix)) created.verification++;
    else if (record.type === "MX") created.mx++;
    else if (record.content.includes("v=spf1")) created.spf++;
    else if (record.content.includes("v=DMARC1")) created.dmarc++;
    else if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) created.dkim++;
  }
  console.log();
  if (created.verification) log.success("Created TXT verification record");
  if (created.mx) log.success("Created MX records");
  if (created.spf) log.success("Created SPF record");
  if (created.dmarc) log.success("Created DMARC record");
  if (created.dkim) log.success("Created DKIM records");
  log.success("\nSetup complete.");
}

// src/dns-modules/gcloud.ts
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var inputs4 = [
  {
    flag: "project",
    name: "Google Cloud project ID",
    env: "CLOUDSDK_CORE_PROJECT",
    example: "my-project-123",
    optional: true,
    instructions: "Defaults to the active gcloud project if not set."
  }
];
async function gcloud(args) {
  const { stdout } = await execFileAsync("gcloud", [...args, "--format=json"]).catch((e) => {
    throw new Error(`gcloud error: ${e.stderr?.trim() || e.message}
Is the gcloud CLI installed and configured?`);
  });
  const text = stdout.trim();
  return text ? JSON.parse(text) : null;
}
async function getManagedZone(domain, gcloudFn) {
  const zones = await gcloudFn(["dns", "managed-zones", "list"]);
  const zone = zones?.find((z) => z.dnsName === `${domain}.`);
  if (!zone) throw new Error(`Managed zone not found for domain: ${domain}`);
  return zone.name;
}
async function listRecords3(zone, gcloudFn) {
  return await gcloudFn(["dns", "record-sets", "list", "--zone", zone]) ?? [];
}
async function upsertRecordSet(fqdn, type, rrdatas, zone, hasExisting, gcloudFn) {
  const cmd = hasExisting ? "update" : "create";
  await gcloudFn([
    "dns",
    "record-sets",
    cmd,
    fqdn,
    "--type",
    type,
    "--ttl",
    "300",
    "--rrdatas",
    rrdatas.join(","),
    "--zone",
    zone
  ]);
}
function toFqdn(name, domain) {
  return name === "@" ? `${domain}.` : `${name}.${domain}.`;
}
function normalizeName2(fqdn, domain) {
  if (fqdn === `${domain}.`) return "@";
  if (fqdn.endsWith(`.${domain}.`)) return fqdn.slice(0, -(domain.length + 2));
  return fqdn;
}
function toGcpValue(record) {
  if (record.type === "MX") {
    const host = record.content.endsWith(".") ? record.content : `${record.content}.`;
    return `${record.priority} ${host}`;
  }
  if (record.type === "TXT") return `"${record.content}"`;
  if (record.type === "CNAME") return record.content.endsWith(".") ? record.content : `${record.content}.`;
  return record.content;
}
function unquoteTxt(value) {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}
function isConflictingValue(existingValue, newRecord, verificationPrefix) {
  if (newRecord.type === "MX") return true;
  const raw = unquoteTxt(existingValue);
  if (newRecord.type === "TXT") {
    if (newRecord.content.includes("v=spf1") && raw.includes("v=spf1")) return true;
    if (verificationPrefix && newRecord.content.includes(verificationPrefix) && raw.includes(verificationPrefix)) return true;
    if (newRecord.content.includes("v=DMARC1") && raw.includes("v=DMARC1")) return true;
  }
  if (newRecord.name.includes("_domainkey") && (newRecord.type === "CNAME" || newRecord.type === "TXT")) return true;
  return false;
}
function formatRecord4(name, type, value) {
  const display = type === "TXT" ? unquoteTxt(value) : value;
  return `  [${type.padEnd(5)}] ${name} \u2192 ${display}`;
}
async function setupRecords4({ domain, records, verificationPrefix, confirm: confirmFn, gcloud: gcloudFn }, { project }) {
  const confirmCmd = confirmFn ?? confirm;
  const projectArgs = project ? ["--project", project] : [];
  const gcloudBase = gcloudFn ?? gcloud;
  const gcloudCmd = (args) => gcloudBase([...args, ...projectArgs]);
  const zoneName = await getManagedZone(domain, gcloudCmd);
  log.success(`Managed zone found: ${zoneName}`);
  const existing = await listRecords3(zoneName, gcloudCmd);
  const groups = /* @__PURE__ */ new Map();
  for (const record of records) {
    const key = `${record.name}|${record.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const toRemove = [];
  const toAdd = [];
  const ops = [];
  for (const [key, newRecords] of groups) {
    const [name, type] = key.split("|");
    const fqdn = toFqdn(name, domain);
    const existingSet = existing.find((e) => e.name === fqdn && e.type === type);
    const existingValues = existingSet?.rrdatas ?? [];
    const retained = [];
    for (const value of existingValues) {
      if (newRecords.some((r) => isConflictingValue(value, r, verificationPrefix))) {
        toRemove.push(formatRecord4(normalizeName2(fqdn, domain), type, value));
      } else {
        retained.push(value);
      }
    }
    const newValues = newRecords.map(toGcpValue);
    for (const r of newRecords) {
      toAdd.push(formatRecord4(r.name, r.type, toGcpValue(r)));
    }
    ops.push({ fqdn, type, rrdatas: [...retained, ...newValues], hasExisting: !!existingSet });
  }
  if (toRemove.length > 0) {
    log.warn("\nThe following existing records will be removed:");
    for (const r of toRemove) log.dim(r);
  } else {
    log.info("\nNo conflicting records found.");
  }
  log.info("\nThe following records will be created:");
  for (const r of toAdd) log.dim(r);
  console.log();
  const ok = await confirmCmd("Proceed? (y/N) ");
  if (!ok) {
    log.warn("Aborted.");
    return;
  }
  for (const op of ops) {
    await upsertRecordSet(op.fqdn, op.type, op.rrdatas, zoneName, op.hasExisting, gcloudCmd);
  }
  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 };
  for (const record of records) {
    if (verificationPrefix && record.content.includes(verificationPrefix)) created.verification++;
    else if (record.type === "MX") created.mx++;
    else if (record.content.includes("v=spf1")) created.spf++;
    else if (record.content.includes("v=DMARC1")) created.dmarc++;
    else if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) created.dkim++;
  }
  console.log();
  if (created.verification) log.success("Created TXT verification record");
  if (created.mx) log.success("Created MX records");
  if (created.spf) log.success("Created SPF record");
  if (created.dmarc) log.success("Created DMARC record");
  if (created.dkim) log.success("Created DKIM records");
  log.success("\nSetup complete.");
}

// src/dns-modules/netlify.ts
var inputs5 = [
  {
    flag: "token",
    name: "Netlify personal access token",
    env: "NETLIFY_AUTH_TOKEN",
    instructions: "Create a token at https://app.netlify.com/user/applications#personal-access-tokens"
  }
];
var BASE_URL4 = process.env.NETLIFY_API_URL ?? "https://api.netlify.com/api/v1";
async function nlFetch(path, options, token) {
  const res = await fetch(`${BASE_URL4}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers
    }
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Netlify API error: ${data.message ?? res.statusText}`);
  }
  if (res.status === 204) return void 0;
  return res.json();
}
async function getZoneId2(domain, token) {
  const zones = await nlFetch("/dns_zones", {}, token);
  const zone = zones.find((z) => z.name === domain);
  if (!zone) {
    throw new Error(`DNS zone not found for domain: ${domain}`);
  }
  return zone.id;
}
async function listRecords4(zoneId, token) {
  return nlFetch(`/dns_zones/${zoneId}/dns_records`, {}, token);
}
async function deleteRecord3(zoneId, recordId, token) {
  await nlFetch(`/dns_zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" }, token);
}
async function createRecord3(zoneId, record, domain, token) {
  const hostname = record.name === "@" ? domain : `${record.name}.${domain}`;
  const body = {
    type: record.type,
    hostname,
    value: record.content,
    ttl: record.ttl ?? 3600
  };
  if (record.priority !== void 0) {
    body.priority = record.priority;
  }
  return nlFetch(`/dns_zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify(body)
  }, token);
}
function normalizeName3(hostname, domain) {
  if (hostname === domain) return "@";
  if (hostname.endsWith(`.${domain}`)) return hostname.slice(0, -(domain.length + 1));
  return hostname;
}
function findConflicts4(existing, records, domain, verificationPrefix) {
  const conflicts = [];
  for (const record of records) {
    const matches = existing.filter((e) => {
      const eName = normalizeName3(e.hostname, domain);
      if (record.type === "MX" && e.type === "MX") return true;
      if (record.type === "TXT" && e.type === "TXT") {
        if (record.content.includes("v=spf1") && e.value.includes("v=spf1")) return true;
        if (verificationPrefix && record.content.includes(verificationPrefix) && e.value.includes(verificationPrefix)) return true;
        if (record.content.includes("v=DMARC1") && eName === record.name) return true;
      }
      if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) {
        if ((e.type === "CNAME" || e.type === "TXT") && eName === record.name) return true;
      }
      return false;
    });
    for (const m of matches) {
      if (!conflicts.find((c2) => c2.id === m.id)) {
        conflicts.push(m);
      }
    }
  }
  return conflicts;
}
function formatRecord5(r, domain) {
  const name = normalizeName3(r.hostname, domain);
  const priority = r.priority !== void 0 ? ` (priority ${r.priority})` : "";
  return `  [${r.type.padEnd(5)}] ${name} \u2192 ${r.value}${priority}`;
}
async function setupRecords5({ domain, records, verificationPrefix, confirm: confirmFn }, { token }) {
  const confirm2 = confirmFn ?? confirm;
  const zoneId = await getZoneId2(domain, token);
  log.success(`Zone found: ${domain}`);
  const existing = await listRecords4(zoneId, token);
  const conflicts = findConflicts4(existing, records, domain, verificationPrefix);
  if (conflicts.length > 0) {
    log.warn("\nThe following existing records will be removed:");
    for (const r of conflicts) {
      log.dim(formatRecord5(r, domain));
    }
  } else {
    log.info("\nNo conflicting records found.");
  }
  log.info("\nThe following records will be created:");
  for (const r of records) {
    log.dim(formatRecord5({ type: r.type, hostname: r.name, value: r.content, priority: r.priority }, domain));
  }
  console.log();
  const ok = await confirm2("Proceed? (y/N) ");
  if (!ok) {
    log.warn("Aborted.");
    return;
  }
  if (conflicts.length > 0) {
    for (const r of conflicts) {
      await deleteRecord3(zoneId, r.id, token);
    }
    log.info(`
Removed ${conflicts.length} conflicting record${conflicts.length !== 1 ? "s" : ""}`);
  }
  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 };
  for (const record of records) {
    await createRecord3(zoneId, record, domain, token);
    if (verificationPrefix && record.content.includes(verificationPrefix)) created.verification++;
    else if (record.type === "MX") created.mx++;
    else if (record.content.includes("v=spf1")) created.spf++;
    else if (record.content.includes("v=DMARC1")) created.dmarc++;
    else if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) created.dkim++;
  }
  console.log();
  if (created.verification) log.success("Created TXT verification record");
  if (created.mx) log.success("Created MX records");
  if (created.spf) log.success("Created SPF record");
  if (created.dmarc) log.success("Created DMARC record");
  if (created.dkim) log.success("Created DKIM CNAME records");
  log.success("\nSetup complete.");
}

// src/dns-modules/route53.ts
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
var execFileAsync2 = promisify2(execFile2);
var inputs6 = [
  {
    flag: "awsProfile",
    name: "AWS profile",
    env: "AWS_PROFILE",
    example: "my-profile",
    optional: true
  }
];
async function aws(args) {
  const { stdout } = await execFileAsync2("aws", [...args, "--output", "json"]).catch((e) => {
    throw new Error(`AWS CLI error: ${e.stderr?.trim() || e.message}
Is the AWS CLI installed and configured?`);
  });
  return JSON.parse(stdout);
}
async function getHostedZoneId(domain, awsFn) {
  const result = await awsFn([
    "route53",
    "list-hosted-zones-by-name",
    "--dns-name",
    `${domain}.`,
    "--max-items",
    "1"
  ]);
  const zone = result.HostedZones.find((z) => z.Name === `${domain}.`);
  if (!zone) throw new Error(`Hosted zone not found for domain: ${domain}`);
  return zone.Id.split("/").pop();
}
async function listRecords5(zoneId, awsFn) {
  const result = await awsFn([
    "route53",
    "list-resource-record-sets",
    "--hosted-zone-id",
    zoneId
  ]);
  return result.ResourceRecordSets;
}
async function applyChanges(zoneId, changes, awsFn) {
  await awsFn([
    "route53",
    "change-resource-record-sets",
    "--hosted-zone-id",
    zoneId,
    "--change-batch",
    JSON.stringify({ Changes: changes })
  ]);
}
function toFqdn2(name, domain) {
  return name === "@" ? `${domain}.` : `${name}.${domain}.`;
}
function unquoteTxt2(value) {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}
function toR53Value(record) {
  if (record.type === "MX") return `${record.priority} ${record.content}.`;
  if (record.type === "TXT") return `"${record.content}"`;
  if (record.type === "CNAME") return record.content.endsWith(".") ? record.content : `${record.content}.`;
  return record.content;
}
function isConflictingValue2(existingValue, newRecord, verificationPrefix) {
  if (newRecord.type === "MX") return true;
  const raw = unquoteTxt2(existingValue);
  if (newRecord.type === "TXT") {
    if (newRecord.content.includes("v=spf1") && raw.includes("v=spf1")) return true;
    if (verificationPrefix && newRecord.content.includes(verificationPrefix) && raw.includes(verificationPrefix)) return true;
    if (newRecord.content.includes("v=DMARC1") && raw.includes("v=DMARC1")) return true;
  }
  if (newRecord.name.includes("_domainkey") && (newRecord.type === "CNAME" || newRecord.type === "TXT")) return true;
  return false;
}
function formatRecord6(name, type, value) {
  const display = type === "TXT" ? unquoteTxt2(value) : value;
  return `  [${type.padEnd(5)}] ${name} \u2192 ${display}`;
}
async function setupRecords6({ domain, records, verificationPrefix, confirm: confirmFn, aws: awsFn }, { awsProfile }) {
  const profileArgs = awsProfile ? ["--profile", awsProfile] : [];
  const awsBase = awsFn ?? aws;
  const awsCmd = (args) => awsBase([...profileArgs, ...args]);
  const confirmCmd = confirmFn ?? confirm;
  const zoneId = await getHostedZoneId(domain, awsCmd);
  log.success(`Hosted zone found: ${domain}`);
  const existing = await listRecords5(zoneId, awsCmd);
  const groups = /* @__PURE__ */ new Map();
  for (const record of records) {
    const key = `${record.name}|${record.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const changes = [];
  const toRemove = [];
  const toAdd = [];
  for (const [key, newRecords] of groups) {
    const [name, type] = key.split("|");
    const fqdn = toFqdn2(name, domain);
    const existingSet = existing.find((e) => e.Name === fqdn && e.Type === type);
    const existingValues = existingSet?.ResourceRecords?.map((r) => r.Value) ?? [];
    const retained = [];
    for (const value of existingValues) {
      if (newRecords.some((r) => isConflictingValue2(value, r, verificationPrefix))) {
        toRemove.push(formatRecord6(name, type, value));
      } else {
        retained.push(value);
      }
    }
    const newValues = newRecords.map(toR53Value);
    for (const r of newRecords) {
      toAdd.push(formatRecord6(r.name, r.type, toR53Value(r)));
    }
    changes.push({
      Action: "UPSERT",
      ResourceRecordSet: {
        Name: fqdn,
        Type: type,
        TTL: 300,
        ResourceRecords: [...retained, ...newValues].map((Value) => ({ Value }))
      }
    });
  }
  if (toRemove.length > 0) {
    log.warn("\nThe following existing records will be removed:");
    for (const r of toRemove) log.dim(r);
  } else {
    log.info("\nNo conflicting records found.");
  }
  log.info("\nThe following records will be created:");
  for (const r of toAdd) log.dim(r);
  console.log();
  const ok = await confirmCmd("Proceed? (y/N) ");
  if (!ok) {
    log.warn("Aborted.");
    return;
  }
  await applyChanges(zoneId, changes, awsCmd);
  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 };
  for (const record of records) {
    if (verificationPrefix && record.content.includes(verificationPrefix)) created.verification++;
    else if (record.type === "MX") created.mx++;
    else if (record.content.includes("v=spf1")) created.spf++;
    else if (record.content.includes("v=DMARC1")) created.dmarc++;
    else if (record.name.includes("_domainkey") && (record.type === "CNAME" || record.type === "TXT")) created.dkim++;
  }
  console.log();
  if (created.verification) log.success("Created TXT verification record");
  if (created.mx) log.success("Created MX records");
  if (created.spf) log.success("Created SPF record");
  if (created.dmarc) log.success("Created DMARC record");
  if (created.dkim) log.success("Created DKIM records");
  log.success("\nSetup complete.");
}

// src/email-modules/ses.ts
import { execFile as execFile3 } from "child_process";
import { promisify as promisify3 } from "util";
var execFileAsync3 = promisify3(execFile3);
var inputs7 = [
  {
    flag: "awsProfile",
    name: "AWS profile",
    env: "AWS_PROFILE",
    example: "my-profile",
    optional: true
  }
];
function makeAws(profileArgs) {
  return async function aws2(args) {
    const { stdout } = await execFileAsync3("aws", [...profileArgs, ...args, "--output", "json"]).catch((e) => {
      throw new Error(`AWS CLI error: ${e.stderr?.trim() || e.message}
Is the AWS CLI installed and configured?`);
    });
    return JSON.parse(stdout);
  };
}
async function getRegion(profileArgs) {
  const { stdout } = await execFileAsync3("aws", [...profileArgs, "configure", "get", "region"]).catch((e) => {
    throw new Error(`AWS CLI error: ${e.stderr?.trim() || e.message}
Is the AWS CLI installed and configured?`);
  });
  const region = stdout.trim();
  if (!region) throw new Error("Could not determine AWS region from profile. Ensure your AWS CLI profile has a default region configured.");
  return region;
}
async function getRecords({ domain, awsProfile }) {
  const profileArgs = awsProfile ? ["--profile", awsProfile] : [];
  const aws2 = makeAws(profileArgs);
  const region = await getRegion(profileArgs);
  const [identity, dkim] = await Promise.all([
    aws2(["ses", "verify-domain-identity", "--domain", domain]),
    aws2(["ses", "verify-domain-dkim", "--domain", domain])
  ]);
  const { VerificationToken } = identity;
  const { DkimTokens } = dkim;
  if (!VerificationToken) throw new Error("SES did not return a verification token");
  if (!DkimTokens || DkimTokens.length < 3) throw new Error("SES did not return 3 DKIM tokens");
  return [
    { type: "TXT", name: "_amazonses", content: VerificationToken, ttl: 1 },
    { type: "MX", name: "@", content: `inbound-smtp.${region}.amazonaws.com`, ttl: 1, priority: 10 },
    { type: "TXT", name: "@", content: "v=spf1 include:amazonses.com ~all", ttl: 1 },
    { type: "TXT", name: "_dmarc", content: "v=DMARC1; p=none;", ttl: 1 },
    { type: "CNAME", name: `${DkimTokens[0]}._domainkey`, content: `${DkimTokens[0]}.dkim.amazonses.com`, ttl: 1 },
    { type: "CNAME", name: `${DkimTokens[1]}._domainkey`, content: `${DkimTokens[1]}.dkim.amazonses.com`, ttl: 1 },
    { type: "CNAME", name: `${DkimTokens[2]}._domainkey`, content: `${DkimTokens[2]}.dkim.amazonses.com`, ttl: 1 }
  ];
}

// src/email-templates/migadu.json
var migadu_default = {
  verificationPrefix: "hosted-email-verify",
  inputs: [
    {
      flag: "verifyTxt",
      name: "Migadu verification TXT value",
      env: "MIGADU_VERIFY_TXT",
      example: "hosted-email-verify=abc123",
      instructions: "In your Migadu account page, go to Email Domains > [Email Domain] > DNS Configuration > Setup Instructions and copy the full TXT record value shown under `Verification TXT Record`."
    }
  ],
  records: [
    { type: "TXT", name: "@", value: "{VERIFY_TXT}" },
    { type: "MX", name: "@", value: "aspmx1.migadu.com", priority: 10 },
    { type: "MX", name: "@", value: "aspmx2.migadu.com", priority: 20 },
    { type: "TXT", name: "@", value: "v=spf1 include:spf.migadu.com -all" },
    { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" },
    { type: "CNAME", name: "key1._domainkey", value: "key1.{DOMAIN}._domainkey.migadu.com" },
    { type: "CNAME", name: "key2._domainkey", value: "key2.{DOMAIN}._domainkey.migadu.com" },
    { type: "CNAME", name: "key3._domainkey", value: "key3.{DOMAIN}._domainkey.migadu.com" }
  ]
};

// src/email-templates/googleworkspace.json
var googleworkspace_default = {
  verificationPrefix: "google-site-verification",
  inputs: [
    {
      flag: "verifyTxt",
      name: "Google Workspace verification TXT value",
      env: "GOOGLE_VERIFY_TXT",
      example: "google-site-verification=abc123",
      instructions: "In Google Admin Console, go to Account > Domains > Manage domains, then click 'Verify' next to your domain and copy the full TXT record value shown."
    },
    {
      flag: "dkimKey",
      name: "Google Workspace DKIM key",
      env: "GOOGLE_DKIM_KEY",
      example: "v=DKIM1; k=rsa; p=...",
      instructions: "In Google Admin Console, go to Apps > Google Workspace > Gmail > Authenticate email, select your domain, generate a new key, then copy the TXT record value shown."
    }
  ],
  records: [
    { type: "TXT", name: "@", value: "{VERIFY_TXT}" },
    { type: "MX", name: "@", value: "smtp.google.com", priority: 1 },
    { type: "TXT", name: "@", value: "v=spf1 include:_spf.google.com ~all" },
    { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" },
    { type: "TXT", name: "google._domainkey", value: "{DKIM_KEY}" }
  ]
};

// src/email-templates/ms365.json
var ms365_default = {
  inputs: [
    {
      flag: "verifyTxt",
      name: "Microsoft 365 domain verification TXT value",
      env: "MS365_VERIFY_TXT",
      example: "MS=ms12345678",
      instructions: "In the Microsoft 365 admin center, go to Settings > Domains, select your domain, and copy the TXT value shown under 'Verify domain' (starts with MS=ms...)."
    },
    {
      flag: "dkimSelector1Target",
      name: "DKIM selector1 CNAME target",
      env: "MS365_DKIM_SELECTOR1",
      example: "selector1-example-com._domainkey.example.onmicrosoft.com",
      instructions: "In the Microsoft 365 admin center under DNS records, find the CNAME record for 'selector1._domainkey' and copy its target value."
    },
    {
      flag: "dkimSelector2Target",
      name: "DKIM selector2 CNAME target",
      env: "MS365_DKIM_SELECTOR2",
      example: "selector2-example-com._domainkey.example.onmicrosoft.com",
      instructions: "Copy the target value for the 'selector2._domainkey' CNAME record."
    }
  ],
  records: [
    { type: "TXT", name: "@", value: "{VERIFY_TXT}" },
    { type: "MX", name: "@", value: "{DOMAIN_DASHES}.mail.protection.outlook.com", priority: 0 },
    { type: "TXT", name: "@", value: "v=spf1 include:spf.protection.outlook.com -all" },
    { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" },
    { type: "CNAME", name: "autodiscover", value: "autodiscover.outlook.com" },
    { type: "CNAME", name: "selector1._domainkey", value: "{DKIM_SELECTOR1_TARGET}" },
    { type: "CNAME", name: "selector2._domainkey", value: "{DKIM_SELECTOR2_TARGET}" }
  ]
};

// src/email-templates/proton.json
var proton_default = {
  verificationPrefix: "protonmail-verification",
  inputs: [
    {
      flag: "verifyTxt",
      name: "Proton Mail domain verification TXT value",
      env: "PROTON_VERIFY_TXT",
      example: "protonmail-verification=abc123",
      instructions: "In the Proton Mail admin panel, go to Settings > Domain names > Add domain, then copy the TXT verification value shown."
    },
    {
      flag: "dkimCname1",
      name: "DKIM CNAME 1 target",
      env: "PROTON_DKIM_CNAME1",
      example: "protonmail.domainkey.abc123.domains.proton.ch",
      instructions: "In the Proton Mail admin panel under Domain names > [your domain] > DKIM, copy the target value for the 'protonmail._domainkey' CNAME record."
    },
    {
      flag: "dkimCname2",
      name: "DKIM CNAME 2 target",
      env: "PROTON_DKIM_CNAME2",
      example: "protonmail2.domainkey.abc123.domains.proton.ch",
      instructions: "Copy the target value for the 'protonmail2._domainkey' CNAME record."
    },
    {
      flag: "dkimCname3",
      name: "DKIM CNAME 3 target",
      env: "PROTON_DKIM_CNAME3",
      example: "protonmail3.domainkey.abc123.domains.proton.ch",
      instructions: "Copy the target value for the 'protonmail3._domainkey' CNAME record."
    }
  ],
  records: [
    { type: "TXT", name: "@", value: "{VERIFY_TXT}" },
    { type: "MX", name: "@", value: "mail.protonmail.ch", priority: 10 },
    { type: "MX", name: "@", value: "mailsec.protonmail.ch", priority: 20 },
    { type: "TXT", name: "@", value: "v=spf1 include:_spf.protonmail.ch ~all" },
    { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" },
    { type: "CNAME", name: "protonmail._domainkey", value: "{DKIM_CNAME1}" },
    { type: "CNAME", name: "protonmail2._domainkey", value: "{DKIM_CNAME2}" },
    { type: "CNAME", name: "protonmail3._domainkey", value: "{DKIM_CNAME3}" }
  ]
};

// src/email-templates/zoho.json
var zoho_default = {
  verificationPrefix: "zoho-verification",
  inputs: [
    {
      flag: "verifyTxt",
      name: "Zoho Mail domain verification TXT value",
      env: "ZOHO_VERIFY_TXT",
      example: "zoho-verification=zb12345678.zmverify.zoho.com",
      instructions: "In the Zoho Mail Admin Console, go to Domains > [your domain] > Domain Verification and copy the full TXT record value shown."
    },
    {
      flag: "dkimKey",
      name: "Zoho Mail DKIM TXT value",
      env: "ZOHO_DKIM_KEY",
      example: "v=DKIM1; k=rsa; p=...",
      instructions: "In the Zoho Mail Admin Console, go to Domains > [your domain] > Email Authentication (DKIM) and copy the TXT record value shown."
    }
  ],
  records: [
    { type: "TXT", name: "@", value: "{VERIFY_TXT}" },
    { type: "MX", name: "@", value: "mx.zoho.com", priority: 10 },
    { type: "MX", name: "@", value: "mx2.zoho.com", priority: 20 },
    { type: "MX", name: "@", value: "mx3.zoho.com", priority: 50 },
    { type: "TXT", name: "@", value: "v=spf1 include:zoho.com ~all" },
    { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" },
    { type: "TXT", name: "zoho._domainkey", value: "{DKIM_KEY}" }
  ]
};

// src/providers.ts
var DNS_PROVIDERS = {
  cloudflare: {
    name: "Cloudflare",
    setupRecords,
    inputs
  },
  digitalocean: {
    name: "DigitalOcean",
    setupRecords: setupRecords3,
    inputs: inputs3
  },
  godaddy: {
    name: "GoDaddy",
    setupRecords: setupRecords2,
    inputs: inputs2
  },
  gcloud: {
    name: "Google Cloud",
    setupRecords: setupRecords4,
    inputs: inputs4
  },
  netlify: {
    name: "Netlify",
    setupRecords: setupRecords5,
    inputs: inputs5
  },
  route53: {
    name: "Amazon Route 53",
    setupRecords: setupRecords6,
    inputs: inputs6
  }
};
var EMAIL_PROVIDERS = {
  migadu: {
    name: "Migadu",
    type: "template",
    template: migadu_default
  },
  googleworkspace: {
    name: "Google Workspace",
    type: "template",
    template: googleworkspace_default
  },
  ms365: {
    name: "Microsoft 365",
    type: "template",
    template: ms365_default
  },
  outlook: {
    name: "Microsoft Outlook",
    type: "template",
    template: ms365_default
  },
  proton: {
    name: "Proton Mail",
    type: "template",
    template: proton_default
  },
  zoho: {
    name: "Zoho Mail",
    type: "template",
    template: zoho_default
  },
  ses: {
    name: "Amazon SES",
    type: "module",
    inputs: inputs7,
    getRecords,
    records: [
      { type: "TXT", name: "_amazonses", value: "{VERIFY_TOKEN}" },
      { type: "MX", name: "@", value: "inbound-smtp.{REGION}.amazonaws.com", priority: 10 },
      { type: "TXT", name: "@", value: "v=spf1 include:amazonses.com ~all" },
      { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" },
      { type: "CNAME", name: "{DKIM_TOKEN_1}._domainkey", value: "{DKIM_TOKEN_1}.dkim.amazonses.com" },
      { type: "CNAME", name: "{DKIM_TOKEN_2}._domainkey", value: "{DKIM_TOKEN_2}.dkim.amazonses.com" },
      { type: "CNAME", name: "{DKIM_TOKEN_3}._domainkey", value: "{DKIM_TOKEN_3}.dkim.amazonses.com" }
    ]
  }
};

// src/core.ts
function buildFromTemplate(template, domain, emailInputs) {
  const toScreamingSnake = (key) => key.replace(/([A-Z])/g, "_$1").toUpperCase();
  const vars = { domain, domainDashes: domain.replaceAll(".", "-"), ...emailInputs };
  const records = template.records.map((record) => {
    let name = record.name;
    let content = record.value;
    for (const [key, val] of Object.entries(vars)) {
      const placeholder = `{${toScreamingSnake(key)}}`;
      name = name.replaceAll(placeholder, val);
      content = content.replaceAll(placeholder, val);
    }
    const normalized = { type: record.type, name, content, ttl: 1 };
    if (record.priority !== void 0) normalized.priority = record.priority;
    return normalized;
  });
  return { records, verificationPrefix: template.verificationPrefix };
}
function getEmailInputDefs(emailProvider) {
  const emailDef = EMAIL_PROVIDERS[emailProvider];
  if (emailDef.type === "template") return emailDef.template.inputs ?? [];
  return emailDef.inputs;
}
async function buildRecords({ domain, emailProvider, emailInputs }) {
  const emailDef = EMAIL_PROVIDERS[emailProvider];
  if (emailDef.type === "template") {
    return buildFromTemplate(emailDef.template, domain, emailInputs);
  }
  const records = await emailDef.getRecords({ domain, ...emailInputs });
  return { records, verificationPrefix: void 0 };
}

// src/cli.ts
var program = new Command();
program.name("mail2dns").description("Configure DNS records for email providers");
function addEmailOptions(cmd) {
  return cmd.option("--verify-txt <value>", "email verification TXT record value").option("--dkim-key <value>", "DKIM key (Google Workspace)");
}
function addDnsOptions(cmd) {
  return cmd.option("--token <token>", "DNS provider API token (or CLOUDFLARE_API_TOKEN env)").option("--aws-profile <profile>", "AWS CLI profile to use (Route 53 and SES)");
}
function validateProviders(emailProvider, dnsProvider) {
  if (!EMAIL_PROVIDERS[emailProvider]) {
    log.error(`Unknown email provider: ${emailProvider}
Supported: ${Object.keys(EMAIL_PROVIDERS).join(", ")}`);
    process.exit(1);
  }
  if (!DNS_PROVIDERS[dnsProvider]) {
    log.error(`Unknown DNS provider: ${dnsProvider}
Supported: ${Object.keys(DNS_PROVIDERS).join(", ")}`);
    process.exit(1);
  }
}
addDnsOptions(addEmailOptions(
  program.command("setup").description("Create DNS records for an email provider").argument("<domain>").argument("<email-provider>", `(${Object.keys(EMAIL_PROVIDERS).join(", ")})`).argument("<dns-provider>", `(${Object.keys(DNS_PROVIDERS).join(", ")})`)
)).action(async (domain, emailProvider, dnsProvider, opts) => {
  validateProviders(emailProvider, dnsProvider);
  const emailInputDefs = getEmailInputDefs(emailProvider);
  const emailInputs = await resolveInputs(emailInputDefs, opts);
  const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs });
  const dnsDef = DNS_PROVIDERS[dnsProvider];
  const dnsInputs = await resolveInputs(dnsDef.inputs, opts);
  await dnsDef.setupRecords({ domain, records, verificationPrefix }, dnsInputs);
});
addEmailOptions(
  program.command("preview").description("Show DNS records that would be created without applying them").argument("<domain>").argument("<email-provider>", `(${Object.keys(EMAIL_PROVIDERS).join(", ")})`)
).action(async (_domain, _emailProvider) => {
  log.warn("preview not yet implemented");
});
addDnsOptions(
  program.command("list").description("Show existing DNS records for a domain").argument("<domain>").argument("<dns-provider>", `(${Object.keys(DNS_PROVIDERS).join(", ")})`)
).action(async (_domain, _dnsProvider) => {
  log.warn("list not yet implemented");
});
addDnsOptions(addEmailOptions(
  program.command("verify").description("Check that expected DNS records are in place").argument("<domain>").argument("<email-provider>", `(${Object.keys(EMAIL_PROVIDERS).join(", ")})`).argument("<dns-provider>", `(${Object.keys(DNS_PROVIDERS).join(", ")})`)
)).action(async (_domain, _emailProvider, _dnsProvider) => {
  log.warn("verify not yet implemented");
});
try {
  await program.parseAsync();
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

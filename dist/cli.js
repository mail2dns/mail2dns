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
async function resolveInputs(inputs5, argv) {
  const result = {};
  for (const input of inputs5) {
    let value = argv[input.flag];
    if (!value && input.env) value = process.env[input.env];
    if (!value) {
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
async function setupRecords({ domain, records, verificationPrefix }, { token }) {
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
  const ok = await confirm("Proceed? (y/N) ");
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

// src/dns-modules/netlify.ts
var inputs3 = [
  {
    flag: "token",
    name: "Netlify personal access token",
    env: "NETLIFY_AUTH_TOKEN",
    instructions: "Create a token at https://app.netlify.com/user/applications#personal-access-tokens"
  }
];
var BASE_URL3 = process.env.NETLIFY_API_URL ?? "https://api.netlify.com/api/v1";
async function nlFetch(path, options, token) {
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
async function listRecords2(zoneId, token) {
  return nlFetch(`/dns_zones/${zoneId}/dns_records`, {}, token);
}
async function deleteRecord2(zoneId, recordId, token) {
  await nlFetch(`/dns_zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" }, token);
}
async function createRecord2(zoneId, record, domain, token) {
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
function normalizeName2(hostname, domain) {
  if (hostname === domain) return "@";
  if (hostname.endsWith(`.${domain}`)) return hostname.slice(0, -(domain.length + 1));
  return hostname;
}
function findConflicts3(existing, records, domain, verificationPrefix) {
  const conflicts = [];
  for (const record of records) {
    const matches = existing.filter((e) => {
      const eName = normalizeName2(e.hostname, domain);
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
function formatRecord3(r, domain) {
  const name = normalizeName2(r.hostname, domain);
  const priority = r.priority !== void 0 ? ` (priority ${r.priority})` : "";
  return `  [${r.type.padEnd(5)}] ${name} \u2192 ${r.value}${priority}`;
}
async function setupRecords3({ domain, records, verificationPrefix }, { token }) {
  const zoneId = await getZoneId2(domain, token);
  log.success(`Zone found: ${domain}`);
  const existing = await listRecords2(zoneId, token);
  const conflicts = findConflicts3(existing, records, domain, verificationPrefix);
  if (conflicts.length > 0) {
    log.warn("\nThe following existing records will be removed:");
    for (const r of conflicts) {
      log.dim(formatRecord3(r, domain));
    }
  } else {
    log.info("\nNo conflicting records found.");
  }
  log.info("\nThe following records will be created:");
  for (const r of records) {
    log.dim(formatRecord3({ type: r.type, hostname: r.name, value: r.content, priority: r.priority }, domain));
  }
  console.log();
  const ok = await confirm("Proceed? (y/N) ");
  if (!ok) {
    log.warn("Aborted.");
    return;
  }
  if (conflicts.length > 0) {
    for (const r of conflicts) {
      await deleteRecord2(zoneId, r.id, token);
    }
    log.info(`
Removed ${conflicts.length} conflicting record${conflicts.length !== 1 ? "s" : ""}`);
  }
  const created = { verification: 0, mx: 0, spf: 0, dmarc: 0, dkim: 0 };
  for (const record of records) {
    await createRecord2(zoneId, record, domain, token);
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

// src/email-modules/ses.ts
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var inputs4 = [
  {
    flag: "awsRegion",
    name: "AWS region",
    env: "AWS_REGION",
    example: "us-east-1"
  }
];
async function aws(args) {
  const { stdout } = await execFileAsync("aws", [...args, "--output", "json"]).catch((e) => {
    throw new Error(`AWS CLI error: ${e.stderr?.trim() || e.message}
Is the AWS CLI installed and configured?`);
  });
  return JSON.parse(stdout);
}
async function getRecords({ domain, awsRegion }) {
  const regionArgs = ["--region", awsRegion];
  const [identity, dkim] = await Promise.all([
    aws(["ses", "verify-domain-identity", "--domain", domain, ...regionArgs]),
    aws(["ses", "verify-domain-dkim", "--domain", domain, ...regionArgs])
  ]);
  const { VerificationToken } = identity;
  const { DkimTokens } = dkim;
  if (!VerificationToken) throw new Error("SES did not return a verification token");
  if (!DkimTokens || DkimTokens.length < 3) throw new Error("SES did not return 3 DKIM tokens");
  return [
    { type: "TXT", name: "_amazonses", content: VerificationToken, ttl: 1 },
    { type: "MX", name: "@", content: `inbound-smtp.${awsRegion}.amazonaws.com`, ttl: 1, priority: 10 },
    { type: "TXT", name: "@", content: "v=spf1 include:amazonses.com ~all", ttl: 1 },
    { type: "TXT", name: "_dmarc", content: "v=DMARC1; p=none;", ttl: 1 },
    { type: "CNAME", name: `${DkimTokens[0]}._domainkey`, content: `${DkimTokens[0]}.dkim.amazonses.com`, ttl: 1 },
    { type: "CNAME", name: `${DkimTokens[1]}._domainkey`, content: `${DkimTokens[1]}.dkim.amazonses.com`, ttl: 1 },
    { type: "CNAME", name: `${DkimTokens[2]}._domainkey`, content: `${DkimTokens[2]}.dkim.amazonses.com`, ttl: 1 }
  ];
}

// src/providers.ts
var DNS_PROVIDERS = {
  cloudflare: {
    name: "Cloudflare",
    setupRecords,
    inputs
  },
  godaddy: {
    name: "GoDaddy",
    setupRecords: setupRecords2,
    inputs: inputs2
  },
  netlify: {
    name: "Netlify",
    setupRecords: setupRecords3,
    inputs: inputs3
  }
};
var EMAIL_PROVIDERS = {
  migadu: {
    name: "Migadu",
    type: "template"
  },
  googleworkspace: {
    name: "Google Workspace",
    type: "template"
  },
  ses: {
    name: "Amazon SES",
    type: "template",
    auto: {
      explanation: "For fully automated SES setup pass the option `--ses-mode=auto`. This will use the AWS CLI to obtain the configuration values (AWS CLI installed on host machine is required).",
      inputs: inputs4,
      getRecords
    }
  }
};

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
    { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=quarantine;" },
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

// src/email-templates/ses.json
var ses_default = {
  verificationPrefix: "_amazonses",
  inputs: [
    {
      flag: "verifyTxt",
      name: "Domain verification TXT value",
      env: "SES_VERIFY_TXT",
      example: "pmBGN/7MjnfhTKUZ06Enqq1PeGUaOkw8lGhcfwefcHU=",
      instructions: "In the AWS SES console, go to Configuration > Verified identities > [your domain]. Under 'Domain verification', copy the TXT record value."
    },
    {
      flag: "dkimToken1",
      name: "DKIM token 1",
      env: "SES_DKIM_TOKEN1",
      instructions: "In the AWS SES console under 'DKIM authentication', copy the Name of the first CNAME record. Paste only the token prefix \u2014 the part before '._domainkey'."
    },
    {
      flag: "dkimToken2",
      name: "DKIM token 2",
      env: "SES_DKIM_TOKEN2",
      instructions: "Copy the token prefix for the second DKIM CNAME record."
    },
    {
      flag: "dkimToken3",
      name: "DKIM token 3",
      env: "SES_DKIM_TOKEN3",
      instructions: "Copy the token prefix for the third DKIM CNAME record."
    },
    {
      flag: "awsRegion",
      name: "AWS region",
      env: "AWS_REGION",
      example: "us-east-1",
      instructions: "The AWS region where your SES is configured (e.g. us-east-1). Used to build the inbound MX endpoint."
    }
  ],
  records: [
    { type: "TXT", name: "_amazonses", value: "{VERIFY_TXT}" },
    { type: "MX", name: "@", value: "inbound-smtp.{AWS_REGION}.amazonaws.com", priority: 10 },
    { type: "TXT", name: "@", value: "v=spf1 include:amazonses.com ~all" },
    { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" },
    { type: "CNAME", name: "{DKIM_TOKEN1}._domainkey", value: "{DKIM_TOKEN1}.dkim.amazonses.com" },
    { type: "CNAME", name: "{DKIM_TOKEN2}._domainkey", value: "{DKIM_TOKEN2}.dkim.amazonses.com" },
    { type: "CNAME", name: "{DKIM_TOKEN3}._domainkey", value: "{DKIM_TOKEN3}.dkim.amazonses.com" }
  ]
};

// src/core.ts
var TEMPLATES = {
  migadu: migadu_default,
  googleworkspace: googleworkspace_default,
  ses: ses_default
};
function readTemplate(name) {
  const template = TEMPLATES[name];
  if (!template) throw new Error(`Unknown email template: ${name}`);
  return template;
}
function buildFromTemplate(templateName, domain, emailInputs) {
  const template = readTemplate(templateName);
  const toScreamingSnake = (key) => key.replace(/([A-Z])/g, "_$1").toUpperCase();
  const vars = { domain, ...emailInputs };
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
function templateInputDefs(templateName) {
  const template = readTemplate(templateName);
  return template.inputs ?? [];
}
function getEmailInputDefs(emailProvider, mode) {
  const emailDef = EMAIL_PROVIDERS[emailProvider];
  if (emailDef.type === "template") {
    return mode === "auto" && emailDef.auto ? emailDef.auto.inputs : templateInputDefs(emailProvider);
  }
  return emailDef.inputs;
}
async function buildRecords({ domain, emailProvider, emailInputs, mode }) {
  const emailDef = EMAIL_PROVIDERS[emailProvider];
  if (emailDef.type === "template") {
    if (mode === "auto" && emailDef.auto) {
      const records2 = await emailDef.auto.getRecords({ domain, ...emailInputs });
      return { records: records2, verificationPrefix: void 0 };
    }
    return buildFromTemplate(emailProvider, domain, emailInputs);
  }
  const records = await emailDef.getRecords({ domain, ...emailInputs });
  return { records, verificationPrefix: void 0 };
}

// src/cli.ts
var program = new Command();
program.name("mail2dns").description("Configure DNS records for email providers");
function addEmailOptions(cmd) {
  return cmd.option("--verify-txt <value>", "email verification TXT record value").option("--dkim-key <value>", "DKIM key (Google Workspace)").option("--aws-region <region>", "AWS region (SES)").option("--ses-mode <mode>", "SES setup mode: auto (AWS CLI) or manual (paste tokens)");
}
function addDnsOptions(cmd) {
  return cmd.option("--token <token>", "DNS provider API token (or CLOUDFLARE_API_TOKEN env)");
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
  let mode;
  if (EMAIL_PROVIDERS[emailProvider].type === "template" && EMAIL_PROVIDERS[emailProvider].auto) {
    if (opts.sesMode === "auto" || opts.sesMode === "manual") {
      mode = opts.sesMode;
    } else {
      const answer = await ask("SES setup \u2014 choose mode:\n  1) Automated (uses AWS CLI to fetch DKIM tokens)\n  2) Manual (paste DKIM tokens from AWS console)\nChoice [1/2]: ");
      mode = answer === "2" ? "manual" : "auto";
    }
  }
  const emailInputDefs = getEmailInputDefs(emailProvider, mode);
  const emailInputs = await resolveInputs(emailInputDefs, opts);
  const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs, mode });
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

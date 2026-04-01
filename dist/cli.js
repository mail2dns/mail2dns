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
async function resolveInputs(inputs2, argv) {
  const result = {};
  for (const input of inputs2) {
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
async function setupRecords({ domain, records, token, confirm: confirm2, verificationPrefix }) {
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
  const ok = await confirm2("Proceed? (y/N) ");
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

// src/email-modules/ses.ts
var inputs = [
  { flag: "awsKey", name: "AWS access key ID", env: "AWS_ACCESS_KEY_ID" },
  { flag: "awsSecret", name: "AWS secret access key", env: "AWS_SECRET_ACCESS_KEY" },
  { flag: "awsRegion", name: "AWS region", env: "AWS_REGION" }
];
async function getRecords({ domain, awsKey, awsSecret, awsRegion }) {
  throw new Error("Amazon SES module not yet implemented");
}

// src/providers.ts
var DNS_PROVIDERS = {
  cloudflare: {
    setupRecords,
    inputs: [
      { flag: "token", name: "Cloudflare API token", env: "CLOUDFLARE_API_TOKEN" }
    ]
  }
};
var EMAIL_PROVIDERS = {
  migadu: { type: "template" },
  googleworkspace: { type: "template" },
  ses: {
    type: "module",
    inputs,
    getRecords
  }
};

// src/email-templates/migadu.json
var migadu_default = {
  verificationPrefix: "hosted-email-verify",
  inputs: [
    { flag: "verifyTxt", name: "Migadu verification TXT value", env: "MIGADU_VERIFY_TXT" }
  ],
  inputInstructions: {
    verifyTxt: "In your Migadu account page, go to Email Domains > [Email Domain] > DNS Configuration > Setup Instructions and copy the full TXT record value shown under `Verification TXT Record`."
  },
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
    { flag: "verifyTxt", name: "Google Workspace verification TXT value", env: "GOOGLE_VERIFY_TXT" },
    { flag: "dkimKey", name: "Google Workspace DKIM key", env: "GOOGLE_DKIM_KEY" }
  ],
  inputInstructions: {
    verifyTxt: "In Google Admin Console, go to Account > Domains > Manage domains, then click 'Verify' next to your domain and copy the full TXT record value shown.",
    dkimKey: "In Google Admin Console, go to Apps > Google Workspace > Gmail > Authenticate email, select your domain, generate a new key, then copy the TXT record value shown."
  },
  records: [
    { type: "TXT", name: "@", value: "{VERIFY_TXT}" },
    { type: "MX", name: "@", value: "smtp.google.com", priority: 1 },
    { type: "TXT", name: "@", value: "v=spf1 include:_spf.google.com ~all" },
    { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" },
    { type: "TXT", name: "google._domainkey", value: "{DKIM_KEY}" }
  ]
};

// src/core.ts
var TEMPLATES = {
  migadu: migadu_default,
  googleworkspace: googleworkspace_default
};
function readTemplate(name) {
  const template = TEMPLATES[name];
  if (!template) throw new Error(`Unknown email template: ${name}`);
  return template;
}
function getEmailInputDefs(emailProvider) {
  const emailDef = EMAIL_PROVIDERS[emailProvider];
  if (emailDef.type === "template") {
    const template = readTemplate(emailProvider);
    const instructions = template.inputInstructions ?? {};
    return (template.inputs ?? []).map((input) => ({ ...input, instructions: instructions[input.flag] }));
  }
  return emailDef.inputs;
}
async function buildRecords({ domain, emailProvider, emailInputs }) {
  const emailDef = EMAIL_PROVIDERS[emailProvider];
  if (emailDef.type === "template") {
    const template = readTemplate(emailProvider);
    const toScreamingSnake = (key) => key.replace(/([A-Z])/g, "_$1").toUpperCase();
    const vars = { domain, ...emailInputs };
    const records2 = template.records.map((record) => {
      let content = record.value;
      for (const [key, val] of Object.entries(vars)) {
        content = content.replaceAll(`{${toScreamingSnake(key)}}`, val);
      }
      const normalized = { type: record.type, name: record.name, content, ttl: 1 };
      if (record.priority !== void 0) normalized.priority = record.priority;
      return normalized;
    });
    return { records: records2, verificationPrefix: template.verificationPrefix };
  }
  const records = await emailDef.getRecords({ domain, ...emailInputs });
  return { records, verificationPrefix: void 0 };
}

// src/cli.ts
var program = new Command();
program.name("mail2dns").description("Configure DNS records for email providers");
function addEmailOptions(cmd) {
  return cmd.option("--verify-txt <value>", "email verification TXT record value").option("--dkim-key <value>", "DKIM key (Google Workspace)").option("--aws-key <key>", "AWS access key ID (SES)").option("--aws-secret <secret>", "AWS secret access key (SES)").option("--aws-region <region>", "AWS region (SES)");
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
  const emailInputDefs = getEmailInputDefs(emailProvider);
  const emailInputs = await resolveInputs(emailInputDefs, opts);
  const { records, verificationPrefix } = await buildRecords({ domain, emailProvider, emailInputs });
  const dnsDef = DNS_PROVIDERS[dnsProvider];
  const dnsInputs = await resolveInputs(dnsDef.inputs, opts);
  await dnsDef.setupRecords({ domain, records, confirm, verificationPrefix, ...dnsInputs });
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

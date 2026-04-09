# 🚀 mail2dns

**CLI that automatically creates MX, SPF, DKIM, DMARC and verification DNS records
for email providers across multiple DNS providers.**

🚀 Stop manually copy-pasting DNS records for email!

⭐ Currently Supports 12 email providers and 10 DNS providers in any combination.


🔗 [See website for setup guides for every provider combination](https://mail2dns.com)  


## Example

```bash
mail2dns setup example.com googleworkspace cloudflare
```

Creates:
- MX records
- SPF record
- DKIM records
- DMARC record
- Domain verification records

## 📦 Installation

Requires Node.js 18+.

```bash
npm install -g mail2dns
```

<!-- generated-usage -->

## ⚙️ Usage

### Setup

Create DNS records for an email provider

```bash
mail2dns setup [options] <domain> <email-provider> <dns-provider>
```

#### [Email Providers](#supported-email-providers)

migadu, googleworkspace, ms365, outlook, fastmail, mailgun, proton, zoho, sendgrid, resend, postmark, ses

#### [DNS Providers](#supported-dns-providers)

cloudflare, digitalocean, godaddy, gcloud, netlify, route53, vercel, hetzner, spaceship, azure

#### Provider Options

Provider-specific options are prompted interactively if not provided via flag or environment variable. See the providers reference below.

#### General Options

| Flag | Description | Default |
|------|-------------|---------|
| <nobr>`-o`, `--no-mx`</nobr> | Skip MX records (set up DNS for outbound email only) | `false` |
| <nobr>`-y`, `--yes`</nobr> | Skip confirmation prompts (the command will error if any required inputs are missing) | `false` |
| <nobr>`--allow-insecure-flags`</nobr> | Allow secrets to be passed via command-line flags (not recommended) | `false` |
| <nobr>`-d`, `--dry-run`</nobr> | Show records that would be created without applying them | `false` |

### Verify

Check that expected DNS records are in place

```bash
mail2dns verify [options] <domain> <email-provider> <dns-provider>
```

### List

Show existing DNS records for a domain

```bash
mail2dns list <domain> <dns-provider>
```

<!-- /generated-usage -->

## 💻 Examples


### Interactive — prompts for any required inputs
```bash
mail2dns setup example.com migadu cloudflare
```

### Non-interactive - inputs provided via flags
```bash
mail2dns setup example.com migadu cloudflare --verify-txt "hosted-email-verify=YOUR_KEY" --token YOUR_CF_TOKEN
```

### Non-interactive - inputs provided via environment variables
```bash
MIGADU_VERIFY_TXT="hosted-email-verify=YOUR_KEY" \
CLOUDFLARE_API_TOKEN=YOUR_CF_TOKEN \
mail2dns setup example.com migadu cloudflare
```
<!-- generated-providers-reference -->

## ✅  Supported Email providers

| Provider | Key |
|----------|-----|
| [Migadu](#migadu) | `migadu` |
| [Google Workspace](#google-workspace) | `googleworkspace` |
| [Microsoft 365](#microsoft-365) | `ms365` |
| [Microsoft Outlook](#microsoft-outlook) | `outlook` |
| [Fastmail](#fastmail) | `fastmail` |
| [Mailgun](#mailgun) | `mailgun` |
| [Proton Mail](#proton-mail) | `proton` |
| [Zoho Mail](#zoho-mail) | `zoho` |
| [Twilio SendGrid](#twilio-sendgrid) | `sendgrid` |
| [Resend](#resend) | `resend` |
| [Postmark](#postmark) | `postmark` |
| [Amazon SES](#amazon-ses) | `ses` |

## ✅ Supported DNS providers

| Provider | Key |
|----------|-----|
| [Cloudflare](#cloudflare) | `cloudflare` |
| [DigitalOcean](#digitalocean) | `digitalocean` |
| [GoDaddy](#godaddy) | `godaddy` |
| [Google Cloud](#google-cloud) | `gcloud` |
| [Netlify](#netlify) | `netlify` |
| [Amazon Route 53](#amazon-route-53) | `route53` |
| [Vercel](#vercel) | `vercel` |
| [Hetzner](#hetzner) | `hetzner` |
| [Spaceship](#spaceship) | `spaceship` |
| [Azure DNS](#azure-dns) | `azure` |

## 📧 Email providers

### Migadu

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--verify-txt`</nobr> | `MIGADU_VERIFY_TXT` | Migadu verification TXT value | `hosted-email-verify=abc123` |

### Google Workspace

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--verify-txt`</nobr> | `GOOGLE_VERIFY_TXT` | Google Workspace verification TXT value | `google-site-verification=abc123` |
| <nobr>`--dkim-key`</nobr> | `GOOGLE_DKIM_KEY` | Google Workspace DKIM key | `v=DKIM1; k=rsa; p=...` |

### Microsoft 365

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--verify-txt`</nobr> | `MS365_VERIFY_TXT` | Microsoft 365 domain verification TXT value | `MS=ms12345678` |
| <nobr>`--dkim-selector1-target`</nobr> | `MS365_DKIM_SELECTOR1` | DKIM selector1 CNAME target | `selector1-example-com._domainkey.example.onmicrosoft.com` |
| <nobr>`--dkim-selector2-target`</nobr> | `MS365_DKIM_SELECTOR2` | DKIM selector2 CNAME target | `selector2-example-com._domainkey.example.onmicrosoft.com` |

### Microsoft Outlook

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--verify-txt`</nobr> | `MS365_VERIFY_TXT` | Microsoft 365 domain verification TXT value | `MS=ms12345678` |
| <nobr>`--dkim-selector1-target`</nobr> | `MS365_DKIM_SELECTOR1` | DKIM selector1 CNAME target | `selector1-example-com._domainkey.example.onmicrosoft.com` |
| <nobr>`--dkim-selector2-target`</nobr> | `MS365_DKIM_SELECTOR2` | DKIM selector2 CNAME target | `selector2-example-com._domainkey.example.onmicrosoft.com` |

### Fastmail


### Mailgun

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--dkim-txt`</nobr> | `MAILGUN_DKIM_TXT` | DKIM TXT value | `k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4...` |

### Proton Mail

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--verify-txt`</nobr> | `PROTON_VERIFY_TXT` | Proton Mail domain verification TXT value | `protonmail-verification=abc123` |
| <nobr>`--dkim-cname1`</nobr> | `PROTON_DKIM_CNAME1` | DKIM CNAME 1 target | `protonmail.domainkey.abc123.domains.proton.ch` |
| <nobr>`--dkim-cname2`</nobr> | `PROTON_DKIM_CNAME2` | DKIM CNAME 2 target | `protonmail2.domainkey.abc123.domains.proton.ch` |
| <nobr>`--dkim-cname3`</nobr> | `PROTON_DKIM_CNAME3` | DKIM CNAME 3 target | `protonmail3.domainkey.abc123.domains.proton.ch` |

### Zoho Mail

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--verify-txt`</nobr> | `ZOHO_VERIFY_TXT` | Zoho Mail domain verification TXT value | `zoho-verification=zb12345678.zmverify.zoho.com` |
| <nobr>`--dkim-key`</nobr> | `ZOHO_DKIM_KEY` | Zoho Mail DKIM TXT value | `v=DKIM1; k=rsa; p=...` |

### Twilio SendGrid

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--dkim1`</nobr> | `SENDGRID_DKIM1` | DKIM CNAME 1 value | `s1.domainkey.u12345.wl.sendgrid.net` |
| <nobr>`--dkim2`</nobr> | `SENDGRID_DKIM2` | DKIM CNAME 2 value | `s2.domainkey.u12345.wl.sendgrid.net` |

### Resend

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--dkim`</nobr> | `RESEND_DKIM` | DKIM CNAME value | `p.resend.com` |

### Postmark

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--dkim`</nobr> | `POSTMARK_DKIM` | DKIM CNAME value | `cm.mtasv.net` |

### Amazon SES

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--aws-profile`</nobr> | `AWS_PROFILE` | AWS profile to use | `my-profile` |

## ⬛ DNS providers

### Cloudflare

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--token`</nobr> | `CLOUDFLARE_API_TOKEN` | Cloudflare API token |  |

### DigitalOcean

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--token`</nobr> | `DIGITALOCEAN_TOKEN` | DigitalOcean API token |  |

### GoDaddy

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--key`</nobr> | `GODADDY_API_KEY` | GoDaddy API key |  |
| <nobr>`--secret`</nobr> | `GODADDY_API_SECRET` | GoDaddy API secret |  |

### Google Cloud

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--project`</nobr> | `CLOUDSDK_CORE_PROJECT` | Google Cloud project ID to use | `my-project-123` |

### Netlify

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--token`</nobr> | `NETLIFY_AUTH_TOKEN` | Netlify personal access token |  |

### Amazon Route 53

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--aws-profile`</nobr> | `AWS_PROFILE` | AWS profile to use | `my-profile` |

### Vercel

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--token`</nobr> | `VERCEL_TOKEN` | Vercel API token |  |
| <nobr>`--team-id`</nobr> | `VERCEL_TEAM_ID` | Vercel team ID |  |

### Hetzner

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--token`</nobr> | `HCLOUD_TOKEN` | Hetzner Cloud API token |  |

### Spaceship

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--api-key`</nobr> | `SPACESHIP_API_KEY` | Spaceship API key |  |
| <nobr>`--api-secret`</nobr> | `SPACESHIP_API_SECRET` | Spaceship API secret |  |

### Azure DNS

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| <nobr>`--subscription`</nobr> | `AZURE_SUBSCRIPTION_ID` | Azure subscription ID to use | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |

<!-- /generated-providers-reference -->

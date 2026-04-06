# mail2dns

Automates the process of creating email DNS records for MX, SPF, DMARC, DKIM, and verification.

## Install

Requires Node.js 18+.

```bash
npm install -g mail2dns
```

## Usage

### Create new DNS records for an email provider
```bash
mail2dns setup [options] <domain> <email-provider> <dns-provider>
```
Inputs specific to each provider are prompted interactively if not provided.
### Verify existing records for an email provider
```bash
mail2dns verify [options] <domain> <email-provider>
```

### List required records for an email provider
```bash
mail2dns list-records [options] <email-provider>
```

## Examples


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
<!-- generated -->

## Supported Email providers

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

## Supported DNS providers

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

## Email providers

### Migadu

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--verify-txt` | `MIGADU_VERIFY_TXT` | Migadu verification TXT value | `hosted-email-verify=abc123` |

### Google Workspace

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--verify-txt` | `GOOGLE_VERIFY_TXT` | Google Workspace verification TXT value | `google-site-verification=abc123` |
| `--dkim-key` | `GOOGLE_DKIM_KEY` | Google Workspace DKIM key | `v=DKIM1; k=rsa; p=...` |

### Microsoft 365

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--verify-txt` | `MS365_VERIFY_TXT` | Microsoft 365 domain verification TXT value | `MS=ms12345678` |
| `--dkim-selector1-target` | `MS365_DKIM_SELECTOR1` | DKIM selector1 CNAME target | `selector1-example-com._domainkey.example.onmicrosoft.com` |
| `--dkim-selector2-target` | `MS365_DKIM_SELECTOR2` | DKIM selector2 CNAME target | `selector2-example-com._domainkey.example.onmicrosoft.com` |

### Microsoft Outlook

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--verify-txt` | `MS365_VERIFY_TXT` | Microsoft 365 domain verification TXT value | `MS=ms12345678` |
| `--dkim-selector1-target` | `MS365_DKIM_SELECTOR1` | DKIM selector1 CNAME target | `selector1-example-com._domainkey.example.onmicrosoft.com` |
| `--dkim-selector2-target` | `MS365_DKIM_SELECTOR2` | DKIM selector2 CNAME target | `selector2-example-com._domainkey.example.onmicrosoft.com` |

### Fastmail


### Mailgun

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--dkim-txt` | `MAILGUN_DKIM_TXT` | DKIM TXT value | `k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4...` |

### Proton Mail

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--verify-txt` | `PROTON_VERIFY_TXT` | Proton Mail domain verification TXT value | `protonmail-verification=abc123` |
| `--dkim-cname1` | `PROTON_DKIM_CNAME1` | DKIM CNAME 1 target | `protonmail.domainkey.abc123.domains.proton.ch` |
| `--dkim-cname2` | `PROTON_DKIM_CNAME2` | DKIM CNAME 2 target | `protonmail2.domainkey.abc123.domains.proton.ch` |
| `--dkim-cname3` | `PROTON_DKIM_CNAME3` | DKIM CNAME 3 target | `protonmail3.domainkey.abc123.domains.proton.ch` |

### Zoho Mail

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--verify-txt` | `ZOHO_VERIFY_TXT` | Zoho Mail domain verification TXT value | `zoho-verification=zb12345678.zmverify.zoho.com` |
| `--dkim-key` | `ZOHO_DKIM_KEY` | Zoho Mail DKIM TXT value | `v=DKIM1; k=rsa; p=...` |

### Twilio SendGrid

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--dkim1` | `SENDGRID_DKIM1` | DKIM CNAME 1 value | `s1.domainkey.u12345.wl.sendgrid.net` |
| `--dkim2` | `SENDGRID_DKIM2` | DKIM CNAME 2 value | `s2.domainkey.u12345.wl.sendgrid.net` |

### Resend

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--dkim` | `RESEND_DKIM` | DKIM CNAME value | `p.resend.com` |

### Postmark

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--dkim` | `POSTMARK_DKIM` | DKIM CNAME value | `cm.mtasv.net` |

### Amazon SES

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--aws-profile` | `AWS_PROFILE` | AWS profile | `my-profile` |

## DNS providers

### Cloudflare

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--token` | `CLOUDFLARE_API_TOKEN` | Cloudflare API token |  |

### DigitalOcean

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--token` | `DIGITALOCEAN_TOKEN` | DigitalOcean API token |  |

### GoDaddy

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--key` | `GODADDY_API_KEY` | GoDaddy API key |  |
| `--secret` | `GODADDY_API_SECRET` | GoDaddy API secret |  |

### Google Cloud

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--project` | `CLOUDSDK_CORE_PROJECT` | Google Cloud project ID | `my-project-123` |

### Netlify

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--token` | `NETLIFY_AUTH_TOKEN` | Netlify personal access token |  |

### Amazon Route 53

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--aws-profile` | `AWS_PROFILE` | AWS profile | `my-profile` |

### Vercel

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--token` | `VERCEL_TOKEN` | Vercel API token |  |
| `--team-id` | `VERCEL_TEAM_ID` | Vercel team ID |  |

### Hetzner

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--token` | `HCLOUD_TOKEN` | Hetzner Cloud API token |  |

### Spaceship

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--api-key` | `SPACESHIP_API_KEY` | Spaceship API key |  |
| `--api-secret` | `SPACESHIP_API_SECRET` | Spaceship API secret |  |

### Azure DNS

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--subscription` | `AZURE_SUBSCRIPTION_ID` | Azure subscription ID | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |

<!-- /generated -->

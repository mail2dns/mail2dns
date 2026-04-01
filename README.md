# mail2dns

Automates the process of creating email DNS records for MX, SPF, DMARC, DKIM, and verification.

## Install

Requires Node.js 18+.

```bash
npm install -g mail2dns
```

## Usage

### Create records for a new email provider
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
## Supported Email providers

| Provider                              | Key             |
|---------------------------------------|-----------------|
| [Migadu](#migadu)                     | migadu          |
| [Amazon SES](#amazon-ses)             | ses             |
| [Google Workspace](#google-workspace) | googleworkspace |

## Supported DNS providers

| Provider                  | Key        |
|---------------------------|------------|
| [Cloudflare](#cloudflare) | cloudflare |


## Email providers

### Migadu

#### Inputs

| Flag           | Env var             | Description                                                                              |
|----------------|---------------------|------------------------------------------------------------------------------------------|
| `‑‑verify-txt` | `MIGADU_VERIFY_TXT` | Full verification TXT value from your Migadu account (e.g. `hosted‑email‑verify=abc123`) |

### Google Workspace

#### Inputs

| Flag           | Env var             | Description                                                                                    |
|----------------|---------------------|------------------------------------------------------------------------------------------------|
| `‑‑verify-txt` | `GOOGLE_VERIFY_TXT` | Full verification TXT value from Google Admin Console (e.g. `google‑site‑verification=abc123`) |
| `‑‑dkim‑key`   | `GOOGLE_DKIM_KEY`   | DKIM TXT value from Google Admin Console (e.g. `v=DKIM1; k=rsa; p=...`)                        |

### Amazon SES

#### Inputs

| Flag           | Env var                 | Description                   |
|----------------|-------------------------|-------------------------------|
| `‑‑aws‑key`    | `AWS_ACCESS_KEY_ID`     | AWS access key ID             |
| `‑‑aws‑secret` | `AWS_SECRET_ACCESS_KEY` | AWS secret access key         |
| `‑‑aws‑region` | `AWS_REGION`            | AWS region (e.g. `us-east-1`) |

## DNS providers

### Cloudflare

#### Inputs

| Flag      | Env var                | Description          |
|-----------|------------------------|----------------------|
| `‑‑token` | `CLOUDFLARE_API_TOKEN` | Cloudflare API token |

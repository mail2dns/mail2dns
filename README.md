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
| [Amazon SES](#amazon-ses) | `ses` |

## Supported DNS providers

| Provider | Key |
|----------|-----|
| [Cloudflare](#cloudflare) | `cloudflare` |

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

### Amazon SES

For fully automated SES setup pass the option `--ses-mode=auto`. This will use the AWS CLI to obtain the configuration values (AWS CLI installed on host machine is required).

#### Inputs

##### Auto Mode

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--aws-region` | `AWS_REGION` | AWS region | `us-east-1` |

##### Manual Mode (default)

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--verify-txt` | `SES_VERIFY_TXT` | Domain verification TXT value | `pmBGN/7MjnfhTKUZ06Enqq1PeGUaOkw8lGhcfwefcHU=` |
| `--dkim-token1` | `SES_DKIM_TOKEN1` | DKIM token 1 |  |
| `--dkim-token2` | `SES_DKIM_TOKEN2` | DKIM token 2 |  |
| `--dkim-token3` | `SES_DKIM_TOKEN3` | DKIM token 3 |  |
| `--aws-region` | `AWS_REGION` | AWS region | `us-east-1` |

## DNS providers

### Cloudflare

#### Inputs

| Flag | Env var | Description | Example |
|------|---------|-------------|---------|
| `--token` | `CLOUDFLARE_API_TOKEN` | Cloudflare API token |  |

<!-- /generated -->

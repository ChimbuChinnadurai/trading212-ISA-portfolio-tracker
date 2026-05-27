# Security Policy

## Supported Versions

This project is actively maintained. Security fixes are applied to the latest version only.

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public GitHub issue**.

Instead, report it via one of the following:

- **GitHub private vulnerability report**: Use the [Security tab](../../security/advisories/new) on this repository
- **Email**: Open an issue requesting a private contact channel, and a maintainer will respond

Please include:

- A clear description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested remediation (optional)

You can expect an acknowledgement within 72 hours and a resolution or status update within 7 days.

## Scope

The following are in scope:

- Authentication / API key handling
- Injection vulnerabilities (XSS, SQLi, command injection)
- Sensitive data exposure
- Dependency vulnerabilities with known CVEs

The following are out of scope:

- Issues requiring physical access to the host
- Social engineering attacks
- Denial-of-service against self-hosted instances

## Security Best Practices for Deployers

- Never commit your `.env` file — it is excluded by `.gitignore` but double-check with `git status`
- Rotate API keys immediately if you suspect they have been exposed
- On GCP Cloud Run, store secrets in Secret Manager, not as plain environment variables
- Restrict Trading212 API key permissions to **read-only** (Portfolio read + History read)
- Use the `TRADING212_BASE_URL` variable to point at the demo environment during testing

# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue**
2. Use GitHub's private vulnerability reporting feature: <https://github.com/civic-source/us-code-tracker/security/advisories/new>
3. Include: description, affected package or workflow, steps to reproduce, and potential impact
4. Allow 90 days for coordinated vulnerability disclosure and remediation before public disclosure

## What We Consider Security Issues

- XML entity expansion (XXE) or parser denial-of-service in `@civic-source/transformer`
- Path traversal or unsafe file generation in statutory/annotation pipelines
- Credential or secret exposure in source, build artifacts, or logs
- Dependency vulnerabilities with known exploits
- CI/CD script-injection vectors from untrusted external inputs

## Response Timeline

We aim to acknowledge vulnerability reports within 48 hours and provide an initial triage and disclosure plan within 7 days for critical issues.

## Supported Versions

Only the latest release on `main` is actively supported with security updates.

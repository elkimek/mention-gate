# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in mention-gate, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email **security@getbased.health** with a description of the vulnerability
3. Include steps to reproduce if possible

You should receive a response within 48 hours.

## Scope

Security issues we care about:

- **API key leakage** — provider API keys exposed in logs, error messages, or OpenClaw dashboard responses
- **Prompt injection** — malicious message content that manipulates the gate's classification prompt to bypass filtering or extract config
- **Information disclosure** — message content or sender information leaked outside the intended classification call

## Security Design

### API Keys

- API keys are stored in OpenClaw's `openclaw.json` config, managed by OpenClaw's credential system
- The dashboard UI marks the `apiKey` field as `sensitive: true` — rendered as a password input with a reveal button
- API keys are only transmitted in HTTP headers to the configured provider endpoint
- Keys are never included in log output — all logging references sender names and message previews only

### Gate Model Communication

- Classification requests contain only the message text and sender name — no system config, API keys, or room metadata
- The gate model sees a single message at a time, not conversation history
- Requests use a 5-second timeout (configurable) to prevent hanging
- All errors fail open — the bot replies rather than silently dropping messages

### Fail-Open Design

The plugin is deliberately fail-open: if the API call fails, times out, or returns an unexpected response, the bot's reply goes through normally. This ensures the gate never causes missed messages. The trade-off is that a gate outage means temporary noise, not silence.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x | Yes |
| < 0.2.0 | No |

Security fixes are applied to the latest version only.

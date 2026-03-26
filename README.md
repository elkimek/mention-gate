# mention-gate

OpenClaw plugin that filters incidental group chat mentions using a cheap LLM gate. Prevents the bot from replying when its name is merely mentioned in passing ("Žofka found something earlier") rather than directly addressed ("Žofka, what do you think?").

## How it works

When the bot is mentioned in a group chat, OpenClaw processes the message and generates a reply. Before that reply is sent, mention-gate intercepts it:

1. **Stash** — `message_received` hook saves the inbound message content and sender.
2. **Classify** — `message_sending` hook calls a cheap model (e.g., Haiku) to classify: "Is this message directed at the bot, or just mentioning it in passing?"
3. **Gate** — If incidental, the reply is cancelled. If directed, it goes through.

DMs always pass through. The gate only applies to group chats.

> **Note:** The main model (e.g., Sonnet) still processes the message — you'll see a typing indicator appear and then drop for incidental mentions. There's currently no OpenClaw hook to block inbound processing before the model runs. This plugin saves reply noise, not inference tokens.

## Install

```bash
openclaw plugins install mention-gate
```

Or from a local path:

```bash
openclaw plugins install /path/to/mention-gate
```

## Configuration

All fields are configurable via the OpenClaw dashboard (**Settings > Config > Automation > Plugins > mention-gate**) or CLI:

```bash
openclaw config set plugins.entries.mention-gate.config.apiKey "sk-ant-..."
openclaw config set plugins.entries.mention-gate.config.botName "Žofka"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `"anthropic"` \| `"openai"` | `"anthropic"` | LLM provider for the gate model |
| `apiKey` | string | *(required)* | API key for the selected provider |
| `model` | string | per-provider | Model for intent classification |
| `botName` | string | `"the bot"` | Bot display name — used in the classification prompt |
| `baseUrl` | string | per-provider | Custom API endpoint (advanced) |
| `timeoutMs` | number | `5000` | Gate request timeout in milliseconds (advanced) |

### Provider defaults

| Provider | Default base URL | Default model |
|----------|-----------------|---------------|
| `anthropic` | `https://api.anthropic.com` | `claude-haiku-4-5-20251001` |
| `openai` | `https://openrouter.ai/api` | `anthropic/claude-haiku-4-5-20251001` |

The `openai` provider works with any OpenAI-compatible endpoint — OpenRouter, Together, local vLLM, etc. Just set `baseUrl` to your endpoint.

## Requirements

- OpenClaw 2026.3.13+
- An API key for Anthropic or any OpenAI-compatible provider

The plugin also requires `mentionPatterns` to be configured in your OpenClaw config so the bot's name triggers processing in group messages:

```json
{
  "messages": {
    "groupChat": {
      "mentionPatterns": ["[Žž]ofka"]
    }
  }
}
```

Replace `[Žž]ofka` with your bot's name. Avoid `\b` word boundaries if the name contains non-ASCII characters — JavaScript regex treats `\b` as ASCII-only.

## Recommended companion settings

**Reply threading** — lets people continue conversations by replying to the bot's messages without mentioning its name:

```json
{
  "channels": {
    "matrix": {
      "replyToMode": "all"
    }
  }
}
```

## Channel support

The plugin is channel-agnostic — it hooks into `message_sending` which fires for all outbound replies. Group detection covers Matrix, Discord, SimpleX, and any channel that sets `metadata.isGroup`.

## Development

```bash
npm install
npm run build    # compile TypeScript
npm run dev      # watch mode
```

## Technical notes

- Uses `api.on()` (typed plugin hooks), not the legacy `api.registerHook()` — the latter writes to a separate registry that the hook dispatcher never reads.
- Fail-open on all errors: if the gate model is unreachable or returns an unexpected response, the reply goes through.
- The stash map is pruned every 2 minutes. Rapid messages in the same conversation overwrite the stash (last message wins).

## License

MIT

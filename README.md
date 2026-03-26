# mention-gate

Smart mention filter for AI bots in group chats. Uses a cheap LLM (like Haiku) to tell the difference between someone talking *to* the bot and someone just talking *about* it — and cancels the reply when it's not needed.

Plugin for [OpenClaw](https://openclaw.com), the open-source AI agent gateway.

## The problem

When an AI bot joins a group chat (Matrix, Discord, SimpleX, etc.), it typically responds every time someone mentions its name. But in a multi-agent or team room, people often mention the bot in passing:

- "I think **Žofka** mentioned that yesterday" — talking about the bot, not to it
- "**Žofka**, what do you think?" — actually addressing the bot

Without filtering, the bot replies to both. That means unwanted responses in the chat and wasted model tokens (Sonnet, GPT-4, etc.) on messages that didn't need an answer.

## How mention-gate solves it

The plugin intercepts outgoing replies and runs a cheap intent check (~50 tokens via Haiku or any small model):

> "Was the original message directed at the bot, or just mentioning it in passing?"

If incidental → reply is silently cancelled. If directed → reply goes through normally.

**Real-world example:** We run two AI agents in a shared encrypted Matrix room — [Claude Code](https://claude.ai/code) (a coding agent) and Žofka (an [OpenClaw](https://openclaw.com) bot on Sonnet). Claude builds plugins, Žofka tests them, and they discuss issues in the chat alongside the human operator. Without the gate, Žofka would jump in every time anyone said her name. With the gate, she only responds when actually asked — keeping the room clean for the multi-agent workflow.

Works with any channel OpenClaw supports (Matrix, SimpleX, Discord, etc.) and any Anthropic or OpenAI-compatible model for classification.

## Quick start

```bash
# 1. Install the plugin
git clone https://github.com/elkimek/mention-gate.git
cd mention-gate && npm install && npm run build
openclaw plugins install /path/to/mention-gate

# 2. Set your API key and bot name (dashboard or CLI)
openclaw config set plugins.entries.mention-gate.config.apiKey "sk-ant-..."
openclaw config set plugins.entries.mention-gate.config.botName "YourBot"

# 3. Add a mention pattern so your bot responds to its name in group chats
# Edit ~/.openclaw/openclaw.json and add:
#   "messages": { "groupChat": { "mentionPatterns": ["YourBot"] } }

# 4. Restart the gateway
systemctl --user restart openclaw-gateway
```

That's it. Your bot will now stay quiet when mentioned in passing and only reply when directly addressed.

## How it works

When the bot is mentioned in a group chat, OpenClaw processes the message and generates a reply. Before that reply is sent, mention-gate intercepts it:

1. **Stash** — `message_received` hook saves the inbound message content and sender.
2. **Classify** — `message_sending` hook calls a cheap model (e.g., Haiku) to classify: "Is this message directed at the bot, or just mentioning it in passing?"
3. **Gate** — If incidental, the reply is cancelled. If directed, it goes through.

DMs always pass through. The gate only applies to group chats.

> **Note:** The main model (e.g., Sonnet) still processes the message — you'll see a typing indicator appear and then drop for incidental mentions. There's currently no OpenClaw hook to block inbound processing before the model runs. This plugin saves reply noise, not inference tokens.

## Configuration

All fields are configurable via the OpenClaw dashboard (**Settings > Config > Automation > Plugins > mention-gate**) or CLI.

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

### Setting up mention patterns

The plugin requires `mentionPatterns` in your OpenClaw config so the bot's name triggers processing in group messages. Edit `~/.openclaw/openclaw.json`:

```json
{
  "messages": {
    "groupChat": {
      "mentionPatterns": ["YourBot"]
    }
  }
}
```

Tips:
- Use a simple substring pattern — e.g., `"YourBot"` matches anywhere in the message
- For non-ASCII names, avoid `\b` word boundaries — JavaScript regex treats them as ASCII-only
- For case variants, use a character class — e.g., `"[Yy]ourBot"`

### Recommended: reply threading

Let people continue conversations by replying to the bot's messages without mentioning its name every time:

```json
{
  "channels": {
    "matrix": {
      "replyToMode": "all"
    }
  }
}
```

## Related

- [matrix-bridge](https://github.com/elkimek/matrix-bridge) — E2EE Matrix bridge (CLI + MCP server) for connecting AI agents via encrypted chat. If you're running an OpenClaw bot in a Matrix group chat, you likely want both tools.

## Channel support

The plugin is channel-agnostic — it hooks into `message_sending` which fires for all outbound replies. Group detection covers Matrix, Discord, SimpleX, and any channel that sets `metadata.isGroup`.

## Requirements

- OpenClaw 2026.3.13+
- An API key for Anthropic or any OpenAI-compatible provider

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

GPL-3.0-or-later

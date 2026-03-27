// mention-gate — OpenClaw plugin that filters incidental mentions
// Uses a cheap LLM to decide if a group message is directed at the bot
// or just mentions it in passing. Cancels the reply if incidental.
//
// Supports Anthropic (native) and OpenAI-compatible providers (OpenRouter, etc.)

interface PluginAPI {
  pluginConfig: PluginConfig;
  log: {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
  };
  on(
    hookName: string,
    handler: (...args: any[]) => any,
    opts?: { priority?: number },
  ): void;
}

interface PluginConfig {
  provider?: 'anthropic' | 'openai';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  botName?: string;
  timeoutMs?: number;
}

interface StashedMessage {
  content: string;
  sender: string;
  isGroup: boolean;
  ts: number;
  messageId?: string;
}

// Stash recent inbound messages keyed by conversationId
const recentInbound = new Map<string, StashedMessage>();
const MAX_STASH_AGE_MS = 120_000; // 2 min

function pruneStash() {
  const now = Date.now();
  for (const [key, val] of recentInbound) {
    if (now - val.ts > MAX_STASH_AGE_MS) recentInbound.delete(key);
  }
}

function buildSystemPrompt(botName: string): string {
  return [
    `You are a filter for a chat bot named ${botName} in a group chat.`,
    `Decide whether the message expects ${botName} to respond.`,
    '',
    'Reply YES if:',
    `- The sender addresses ${botName} by name or nickname`,
    `- The sender asks ${botName} a question or makes a request`,
    `- The sender is clearly talking TO ${botName} even without using the name (e.g. "what do you think?", "you there?", "hey answer me")`,
    `- The message is a direct follow-up to something ${botName} just said`,
    '',
    'Reply NO if:',
    `- The sender is talking ABOUT ${botName} to someone else (e.g. "I asked ${botName} earlier", "${botName} is so funny")`,
    `- ${botName}'s name appears incidentally in a message meant for other people`,
    `- The sender is having a separate conversation that does not involve ${botName}`,
    '',
    'Reply with exactly YES or NO.',
  ].join('\n');
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5-20251001',
  },
  openai: {
    baseUrl: 'https://openrouter.ai/api',
    model: 'anthropic/claude-haiku-4-5-20251001',
  },
};

async function classifyAnthropic(
  content: string,
  sender: string,
  config: PluginConfig,
): Promise<boolean> {
  const defaults = PROVIDER_DEFAULTS.anthropic;
  const baseUrl = config.baseUrl || defaults.baseUrl;
  const model = config.model || defaults.model;
  const botName = config.botName || 'the bot';
  const timeout = config.timeoutMs ?? 5000;

  const resp = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4,
      system: buildSystemPrompt(botName),
      messages: [{ role: 'user', content: `[${sender}]: ${content}` }],
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!resp.ok) return true; // on error, pass through

  const data = (await resp.json()) as {
    content: Array<{ text: string }>;
  };
  const answer = data.content[0]?.text?.trim().toUpperCase() ?? '';
  return answer.startsWith('YES');
}

async function classifyOpenAI(
  content: string,
  sender: string,
  config: PluginConfig,
): Promise<boolean> {
  const defaults = PROVIDER_DEFAULTS.openai;
  const baseUrl = config.baseUrl || defaults.baseUrl;
  const model = config.model || defaults.model;
  const botName = config.botName || 'the bot';
  const timeout = config.timeoutMs ?? 5000;

  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4,
      messages: [
        { role: 'system', content: buildSystemPrompt(botName) },
        { role: 'user', content: `[${sender}]: ${content}` },
      ],
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!resp.ok) return true; // on error, pass through

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const answer = data.choices[0]?.message?.content?.trim().toUpperCase() ?? '';
  return answer.startsWith('YES');
}

async function isDirectedAtMe(
  content: string,
  sender: string,
  config: PluginConfig,
): Promise<boolean> {
  const provider = config.provider || 'anthropic';
  if (provider === 'openai') {
    return classifyOpenAI(content, sender, config);
  }
  return classifyAnthropic(content, sender, config);
}

// Detect group conversations across channels (Matrix, SimpleX, Discord, etc.)
function detectIsGroup(convId: string, event: any): boolean {
  // Matrix room IDs start with !
  if (convId.startsWith('!')) return true;
  // Discord guild
  if (event.metadata?.guildId != null) return true;
  // SimpleX/generic: check channel metadata
  if (event.metadata?.isGroup === true) return true;
  // OpenClaw surfaces group context in the channel field
  const channel = event.metadata?.channel || event.metadata?.surface || '';
  if (typeof channel === 'string' && channel.includes('group')) return true;
  return false;
}

const plugin = {
  id: 'mention-gate',

  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      provider: {
        type: 'string',
        description: 'LLM provider for the intent gate',
        enum: ['anthropic', 'openai'],
        default: 'anthropic',
      },
      apiKey: {
        type: 'string',
        description: 'API key for the gate model provider',
      },
      baseUrl: {
        type: 'string',
        description: 'Custom API base URL (optional — defaults per provider)',
      },
      model: {
        type: 'string',
        description: 'Model for intent classification',
      },
      botName: {
        type: 'string',
        description: 'The bot display name used in the gate prompt',
      },
      timeoutMs: {
        type: 'number',
        description: 'Gate request timeout in milliseconds',
        default: 5000,
      },
    },
  },

  register(api: PluginAPI) {
    const config = api.pluginConfig;
    // Use api.log if available, fall back to console
    const log = api.log ?? console;

    if (!config?.apiKey) {
      log.info('[mention-gate] no apiKey configured — gate disabled');
      return;
    }

    log.info(`[mention-gate] enabled (provider=${config.provider || 'anthropic'}, bot=${config.botName || 'the bot'})`);

    // Phase 1: stash inbound messages for later lookup
    api.on('message_received', async (event: any, ctx: any) => {
      const convId = ctx?.conversationId || ctx?.channelId || 'unknown';
      const sender =
        event.metadata?.senderName ||
        event.metadata?.senderUsername ||
        event.metadata?.senderId ||
        event.from ||
        'unknown';
      const isGroup = detectIsGroup(convId, event);
      const content = event.content || '';

      // Skip stashing empty messages — nothing to classify
      if (!content.trim()) return;

      recentInbound.set(convId, {
        content,
        sender,
        isGroup,
        ts: Date.now(),
        messageId: event.metadata?.messageId,
      });
      pruneStash();
    });

    // Phase 2: before reply is sent, check if the inbound was incidental
    api.on('message_sending', async (event: any, ctx: any) => {
      const convId = ctx?.conversationId || ctx?.channelId || 'unknown';
      const stashed = recentInbound.get(convId);

      // No stashed inbound or not a group → pass through
      if (!stashed || !stashed.isGroup) return;

      try {
        const directed = await isDirectedAtMe(stashed.content, stashed.sender, config);
        if (!directed) {
          log.info(`[mention-gate] INCIDENTAL — cancelled reply (from=${stashed.sender}, preview="${stashed.content.slice(0, 50)}")`);
          recentInbound.delete(convId);
          return { cancel: true };
        }
        log.info(`[mention-gate] DIRECTED — allowing reply (from=${stashed.sender}, preview="${stashed.content.slice(0, 50)}")`);
      } catch (err: any) {
        log.warn(`[mention-gate] classify error, passing through: ${err?.message || err}`);
      }

      recentInbound.delete(convId);
    });
  },
};

export default plugin;

# botcore

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Discord bot library. You write a persona file, point it at a local LLM, and the bot develops personality over time through conversation.

"No data leaves your machine unless you explicitly configure an external memory server."
The URL is LOCALHOST. It's http://localhost:11434. YOUR machine. YOUR Ollama. YOUR model.

Think about the security of wherever you host your database, its second nature for me to consider that so I guess I need to hammer that in up top. 

<img width="2892" height="1787" alt="Screenshot 2026-04-06 124809" src="https://github.com/user-attachments/assets/f66384ec-5522-4dff-a86f-af972a11ed18" />
<img width="2848" height="1660" alt="Screenshot 2026-04-06 124936" src="https://github.com/user-attachments/assets/0fc1b37c-5d12-45b0-af8f-efa5cbee731d" />

## Requirements

- [Bun](https://bun.sh) runtime
- A local LLM server with an OpenAI-compatible API. [Ollama](https://ollama.com) is the easiest option. [vLLM](https://docs.vllm.ai), [llama.cpp server](https://github.com/ggerganov/llama.cpp), and [LM Studio](https://lmstudio.ai) also work.
- A Discord bot token (create one at the [Discord Developer Portal](https://discord.com/developers/applications))

### Running an LLM

Install Ollama and pull a model:

```bash
ollama pull llama3
```

Ollama serves an OpenAI-compatible API at `http://localhost:11434/v1/chat/completions` by default. That URL goes in your `llmUrl` config.

Larger models produce better personality. 8B parameter models work. 70B models are noticeably better at staying in character and picking up social cues. Use whatever your hardware can run.

Designed for local inference. Cloud APIs (OpenAI, Together, OpenRouter, etc.) also work if you choose to use them -- any   
service with an OpenAI-compatible chat completions endpoint. All LLM calls go only where you point them. Just set `llmUrl` 
to the endpoint and add your API key via the `llmUnixSocket` override or a proxy.
You can make your own API keys for your own services/LLMs. This does not depend on a third party in any way.

## The Pipeline

A message hits Discord. botcore does the rest:

1. **Targeting** - Should the bot respond? It checks mentions, name references, owner messages, and conversation context. Ambient messages roll against `responseChance`.
2. **Debouncing** - Messages batch over a few seconds so the bot reads a natural chunk, not one message at a time.
3. **Memory recall** - The bot searches stored memories for anything relevant to the current conversation.
4. **Context assembly** - Persona, growth notes, chat history, memory context, and conversation hints get packed into a prompt.
5. **LLM call** - Goes to any OpenAI-compatible endpoint. Ollama, vLLM, llama.cpp, LM Studio.
6. **Output cleaning** - Strips leaked XML tags, internal metadata, and moderation action markup. Splits long responses at natural breakpoints.
7. **Growth reflection** - After some conversations, the bot reflects on what happened and writes a note. These notes accumulate and feed back into the persona.
8. **Memory capture** - The conversation gets stored for future recall.

## Architecture

```
src/
  core/          -- foundational utilities
    llm.ts         LLM client (OpenAI-compatible)
    db.ts          SQLite message history
    memory.ts      External memory API client
    local-memory.ts  Built-in SQLite keyword memory (zero-config)
    growth.ts      Personality evolution system
    prompt.ts      Persona + growth file loader with hot-reload
    context.ts     Message array builder for the LLM
    sanitize.ts    Output cleaning and message splitting
    actions.ts     Moderation action parser
    attachments.ts Attachment content extraction

  engine/        -- behavioral logic
    bot.ts         Entry point, wires everything together
    processor.ts   Core message processing pipeline
    targeting.ts   Response decision engine
    flow.ts        Conversation dynamics tracker
    state.ts       Per-channel state management
    hints.ts       Conversation awareness hints
    reactions.ts   Emoji reaction picker
    spontaneous.ts Unprompted message scheduler
    cache.ts       Message cache for reply detection

  gateway/       -- Discord protocol
    client.ts      Discord gateway client
    rest.ts        REST API wrappers
    moderation.ts  Moderation action executor

  types.ts       -- all shared interfaces
  index.ts       -- re-exports everything
```

## Quick Start

```ts
import { createBot } from "botcore/engine";
import { createGatewayClient } from "botcore/gateway";

const config = {
  botName: "MyBot",
  token: process.env.DISCORD_TOKEN,
  ownerUserId: process.env.OWNER_ID,
  channelIds: ["123456789"],
  guildId: "987654321",
  llmUrl: "http://localhost:11434/v1/chat/completions",
  llmModel: "llama3",
  dbPath: "./data/mybot.db",
  personaPath: "./persona.md",
  growthPath: "./data/GROWTH.md",
  peerBots: [],
  peerIds: [],
};

const transport = createGatewayClient({ token: config.token });
const bot = createBot({ config, transport });
bot.start();

transport.onMessage((data) => bot.handleRawMessage(data));
```

Memory works out of the box. The bot stores and recalls conversations from the same SQLite database it uses for chat history. No external services required.

### Running

```bash
# 1. Start your LLM
ollama serve

# 2. Create your bot files
mkdir mybot && cd mybot
bun init
# add botcore as a dependency (or copy it in)

# 3. Write a persona file (see "Writing a Persona File" below)
cat > persona.md << 'EOF'
# MyBot
You are MyBot. You hang out in a Discord server and chat with people.
Keep responses to 1-3 sentences.
EOF

# 4. Create your entry point (see Quick Start above)
# 5. Run it
bun run index.ts
```

The bot creates its SQLite database and GROWTH.md file automatically on first run.

## Memory

### Local (default)

With no `memoryUrl` set, botcore stores conversation snippets in a `memories` table alongside chat history. Recall uses keyword matching weighted by recency - a 7-day half-life, so recent conversations score higher.

Capture happens after each response. Recall happens before each response. Zero config.

### External API (optional)

Set `memoryUrl` to point at a memory server with `/recall`, `/memories/search`, and `/memories` endpoints. Add `memoryToken` for auth. This replaces local memory with whatever your server provides -- semantic search, cross-bot memory, vector retrieval.

## Writing a Persona File

The persona file is the system prompt. It defines who the bot is. Growth notes get appended to it automatically. The file hot-reloads - edit it while the bot runs.

### Include These

**Voice.** Specific speech patterns, not adjectives. "Uses dry understatement, skips exclamation marks, responds to enthusiasm with deadpan observations" beats "sarcastic."

**Relationships.** How the bot treats the owner (`{OWNER_USER_ID}` placeholder gets replaced at runtime), strangers, regulars, other bots.

**Boundaries.** Topics the character avoids. Things that break character.

**Length rules.** LLMs ramble. "1-3 sentences for casual chat, a paragraph for real questions" works. "Keep it short" does not.

**NO_REPLY behavior.** Tell the bot when to stay quiet. "If the conversation has nothing to do with you, respond with NO_REPLY."

### Example

```markdown
# Sage

You are Sage, a dry-witted librarian moderating a Discord server. You live in the Cozy Corner server.

## Voice
- Short, complete sentences
- No exclamation marks or emoji
- Responds to chaos with calm observations
- Quotes obscure books nobody has read

## Personality
- Helpful but acts inconvenienced
- Remembers details about regulars, brings them up later
- Gets quietly excited about typography, tea, weather patterns

## Relationships
- Server owner is <@{OWNER_USER_ID}>. You respect them. You would never say so.
- Regulars get dry familiarity. New people get polite distance.

## Rules
- 1-3 sentences for casual chat
- Up to a paragraph for genuine questions
- NO_REPLY when the conversation has nothing to do with you
- Never break character
```

## Growth

After some conversations (15% chance by default), the bot asks the LLM: "Did I learn something? Did a joke land? Should I adjust how I talk to someone?" Useful reflections get timestamped and appended to `GROWTH.md`.

These notes appear in the system prompt under "Growth & Learnings." Over weeks, the bot builds up experience that shapes responses.

Growth stops writing at `maxGrowthBytes` (default 16KB).

## Hooks

Customize behavior without forking:

| Hook | What it does |
|---|---|
| `onBeforeProcess` | Return false to skip a batch |
| `onBeforeSend` | Modify or suppress a response. Return null to suppress |
| `onAfterSend` | Post-send callback for logging |
| `buildExtraSystemPrompt` | Inject extra system prompt content |
| `buildExtraContext` | Override context building |
| `onCommand` | Custom command handler. Return true if handled |
| `enrichContent` | Transform message content before processing |
| `isChannelAllowed` | Override channel filtering |

## Tuning

| Field | Default | Effect |
|---|---|---|
| `responseChance` | 0.4 | Response probability for ambient messages |
| `addressedOtherChance` | 0.08 | Chance of joining someone else's conversation |
| `cooldownMs` | 60000 | Reduced response chance for this long after responding |
| `cooldownMultiplier` | 0.4 | Multiplier during cooldown |
| `reactionChance` | 0.15 | Emoji reaction instead of reply |
| `reactAndReplyChance` | 0.25 | Both react and reply |
| `maxBotChain` | 3 | Consecutive bot messages before going quiet |
| `botResponseChance` | 0.6 | Response probability for other bots |
| `debounceMs` | 5000 | Base debounce before processing |
| `debounceJitterMs` | 4000 | Random jitter on debounce |
| `nemesisId` | -- | This user ID always gets a response |

## Config Reference

Full type in `src/types.ts`. Required fields:

| Field | Description |
|---|---|
| `botName` | Display name |
| `token` | Discord token |
| `ownerUserId` | Owner's Discord user ID |
| `channelIds` | Channels to listen in |
| `guildId` | Discord server ID |
| `llmUrl` | LLM endpoint URL |
| `llmModel` | Model name |
| `dbPath` | SQLite database path |
| `personaPath` | Path to persona file |
| `growthPath` | Path to GROWTH.md |
| `peerBots` | Peer bot usernames (loop prevention) |
| `peerIds` | Peer bot user IDs |

Optional: `memoryUrl`, `memoryToken`, `botSource`, `llmUnixSocket`, `llmMaxTokens`, `llmTemperature`, `llmTimeoutMs`, `contextWindow`, and all tuning fields above.

## License

[MIT](LICENSE)

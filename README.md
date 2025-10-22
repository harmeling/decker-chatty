# Description

Small script that creates a proxy that relays messages to ChatGPT using a provided API Key.

Used by decker's `chatty` plugin to allow chatting with Prof. Bot.

# Setup

Edit `config.json`.

``` bash
npm install
npm start
```

Configure your reverse proxy to relay `https://` requests to the running service.

# Variants

- `server.mjs`:  The original one that works with `response` open ai stuff.
- `server-llm-proxy.mjs`:  The version that works on the LLM side with `chat/completions` but translate it to `response` style, so that the client in decker stays unmodified.
- `server-llm-proxy-history.mjs`:  Add a history, so a conversation stays in context.

# Monitoring

Just run on the server:

    sudo journalctl -u tutor.service
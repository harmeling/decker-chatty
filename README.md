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

# Restart everything

sudo vim /etc/systemd/system/tutor.service
sudo systemctl daemon-reload
sudo systemctl restart tutor   # modify 'tutor' to your service name or server-llm-proxy-history.mjs

# Get list of all models:

```bash
  curl -X POST --url https://chat-ai.academiccloud.de/v1/models --header 'Accept: application/json' --header 'Authorization: Bearer <api_key>' --header 'Content-Type: application/json'
  ```
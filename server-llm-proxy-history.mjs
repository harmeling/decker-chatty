// npm init -y
// npm install express cors
// node server.js

import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import config from "./config.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- load instruction.txt once at startup ---
const instructionPath = path.join(__dirname, "instruction.txt");
const instruction = fs.readFileSync(instructionPath, "utf8").trim();

const app = express();
app.use(cors());            // relax or remove in production
app.use(express.json());    // parse JSON bodies

// ---- in-memory history (keyed by conversationId) ----
const histories = new Map();                  // Map<string, Array<{role, content}>>
const MAX_MESSAGES = 30;                      // crude cap; swap for token-based if needed
const getHistory = (id) => (histories.get(id) || []).slice(-MAX_MESSAGES);
const setHistory = (id, msgs) => histories.set(id, msgs.slice(-MAX_MESSAGES));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/chatty", async (req, res) => {
  try {
    const apiKey = config.apiKey;

    // Conversation id comes from the client (previous_response_id).
    // If not provided (new chat), mint a fresh one and return it as response.id.
    let conversationId = req.body?.previous_response_id || null;
    if (!conversationId || conversationId === "null") {
      conversationId = crypto.randomUUID();
    }

    // Ensure streaming is on unless the client overrides it
    let body = { stream: true, ...req.body };

    // normalize `input` to an array of {role, content}
    const input = Array.isArray(body.input)
      ? body.input
      : body.input
        ? [{ role: "user", content: String(body.input) }]
        : [];

    // --- logging with timestamp
    console.log(new Date().toISOString(), "conversationId:", conversationId);
    console.log("client body (pre-build):", {
      ...body,
      apiKey: "[redacted]",
    });

    // pull prior turns and stage the new user turn (committed when we finish streaming)
    const prior = getHistory(conversationId);
    const staged = [...prior, ...input];
    setHistory(conversationId, staged);

    // Build upstream Chat Completions request
    // Forward the client's prompt object because they use it to select RAG on the upstream.
    body = {
      stream: true,
      model: config.model,
      messages: [{ role: "developer", content: instruction }, ...staged],
      prompt: req.body?.prompt,   // forward as-is for RAG selection
      // arcana: body.prompt,     // keep only if your upstream expects this vendor field
    };

    const upstream = await fetch(config.endpoint + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      console.log("upstream error:", upstream.status, text);
      return res.status(upstream.status).send(text || "Upstream error");
    }

    // Prepare SSE to client
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const decoder = new TextDecoder();
    let fullText = "";
    let upstreamFirstId = null;
    let announcedCreated = false;

    // Announce the conversation id immediately so the client can remember it.
    // (Do this once, before any deltas.)
    const announceCreated = () => {
      if (announcedCreated) return;
      announcedCreated = true;
      res.write(
        `data: ${JSON.stringify({
          type: "response.created",
          response: { id: conversationId },
        })}\n\n`
      );
    };

    for await (const chunk of upstream.body) {
      const text = decoder.decode(chunk, { stream: true });

      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();

        if (payload === "[DONE]") {
          // commit assistant message to history
          setHistory(conversationId, [
            ...staged,
            { role: "assistant", content: fullText },
          ]);

          // notify client completion (with our conversation id)
          res.write(
            `data: ${JSON.stringify({
              type: "response.completed",
              response: { id: conversationId },
            })}\n\n`
          );

          continue;
        }

        let json;
        try { json = JSON.parse(payload); } catch { continue; }

        if (json.object === "chat.completion.chunk") {
          if (!upstreamFirstId && json.id) {
            upstreamFirstId = json.id;
            // Ensure the client already has an id to chain with
            announceCreated();
          }

          const delta = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            fullText += delta;
            // emit Responses-style delta event expected by your client
            res.write(
              `data: ${JSON.stringify({
                type: "response.output_text.delta",
                delta,
                response: { id: conversationId },
              })}\n\n`
            );
          }
        }
      }
    }

    // final sentinel for parsers that expect it
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    try {
      res.status(500).send("Proxy error");
    } catch {}
  }
});

const port = process.env.PORT || config.port || 3000;
app.listen(port, () => console.log(`Proxy on http://localhost:${port}`));
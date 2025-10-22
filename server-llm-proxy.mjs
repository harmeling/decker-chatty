// npm init -y
// npm install express cors
// node server.js

import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "./config.json" with {type: "json"};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- load instruction.txt once at startup ---
const instructionPath = path.join(__dirname, "instruction.txt");
const instruction = fs.readFileSync(instructionPath, "utf8").trim();

const app = express();
app.use(cors()); // relax or remove in production
app.use(express.json()); // parse JSON bodies

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/chatty", async (req, res) => {
  try {
    const apiKey = config.apiKey;

    // Ensure streaming is on unless the client overrides it
    let body = { stream: true, ...req.body };

    // normalize `input` to an array of {role, content}
    const input = Array.isArray(body.input)
      ? body.input
      : body.input
        ? [{ role: "user", content: String(body.input) }]
            : [];
    console.log(new Date().toISOString());
    console.log("before:", body);
    body = {
      stream: true,
      model: config.model,
      messages: [{ role: "developer", content: instruction }, ...input],
      arcana: body.prompt
    };
    console.log(body);

    // Call OpenAI Responses API (streams Server-Sent Events)
    const upstream = await fetch(config.endpoint+"/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      console.log(text);
      return res.status(upstream.status).send(text || "Upstream error");
    }

    // Pass through the SSE stream as-is
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const decoder = new TextDecoder();
    let fullText = "";
    let firstId = null;
    
    for await (const chunk of upstream.body) {
      const text = decoder.decode(chunk, { stream: true });

      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          res.write(`data: ${JSON.stringify({ type: "response.completed", response: { id: firstId } })}\n\n`);
          continue;
        }
        let json; try { json = JSON.parse(payload); } catch { continue; }

        if (json.object === "chat.completion.chunk") {
          if (!firstId && json.id) firstId = json.id;
          const delta = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            fullText += delta;
            // emit a Responses-style delta event
            res.write(`data: ${JSON.stringify({
              type: "response.output_text.delta",
              delta,
              response: { id: firstId }
            })}\n\n`);
          }
        }
      }
    }
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send("Proxy error");
  }
});

const port = process.env.PORT || config.port || 3000;
app.listen(port, () => console.log(`Proxy on http://localhost:${port}`));

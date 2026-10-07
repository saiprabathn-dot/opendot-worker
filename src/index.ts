/**
 * OpenDot AI Worker - Cloudflare Workers AI Proxy
 * Provides OpenAI-compatible /v1/chat/completions, /v1/responses, and /v1/models
 * powered directly by Cloudflare Workers AI with 0 latency bottlenecks and 0 rate limits.
 */

export interface Env {
  AI: Ai;
  AUTH_TOKEN?: string;
  DEFAULT_MODEL?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  context_length: number;
  parameters: string;
  category: "general" | "coding" | "vision" | "fast";
}

export const SUPPORTED_MODELS: ModelInfo[] = [
  // ── Flagship Reasoning & Multimodal Agent ──
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    name: "Meta Llama 4 Scout 17B (16E MoE)",
    description: "Meta's flagship multimodal mixture-of-experts model for text, vision, and agentic workflows",
    context_length: 131072,
    parameters: "17B MoE",
    category: "general",
  },
  {
    id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    name: "DeepSeek R1 Distill Qwen 32B",
    description: "DeepSeek R1 chain-of-thought reasoning architecture distilled into 32B parameters",
    context_length: 131072,
    parameters: "32B",
    category: "general",
  },
  {
    id: "@cf/qwen/qwq-32b",
    name: "QwQ 32B Reasoning",
    description: "Alibaba's advanced thinking and reasoning model competing with DeepSeek-R1 and o1-mini",
    context_length: 32768,
    parameters: "32B",
    category: "general",
  },

  // ── Coding & Technical ──
  {
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B Instruct",
    description: "Premier open-source code generation, debugging, and multi-file architecture",
    context_length: 32768,
    parameters: "32B",
    category: "coding",
  },

  // ── Vision & Multimodal ──
  {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    name: "Mistral Small 3.1 24B (Vision & Text)",
    description: "State-of-the-art vision understanding and 128k context without compromising text speed",
    context_length: 131072,
    parameters: "24B Vision",
    category: "vision",
  },

  // ── Large Frontier ──
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "Llama 3.3 70B Instruct",
    description: "Meta's powerful 70B model in fast FP8 precision — best free open model for complex tasks",
    context_length: 131072,
    parameters: "70B",
    category: "general",
  },

  // ── Fast, Light & High-Throughput ──
  {
    id: "@cf/meta/llama-3.2-3b-instruct",
    name: "Llama 3.2 3B Instruct",
    description: "Ultra-fast low-latency agent execution and routine tasks",
    context_length: 131072,
    parameters: "3B",
    category: "fast",
  },
  {
    id: "@cf/meta/llama-3.2-1b-instruct",
    name: "Llama 3.2 1B Instruct",
    description: "Instant sub-second edge response for quick status checks and summaries",
    context_length: 131072,
    parameters: "1B",
    category: "fast",
  },
  {
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    name: "Llama 3.1 8B Instruct Fast",
    description: "High-throughput 8B model optimized for real-time conversation and edge latency",
    context_length: 65536,
    parameters: "8B Fast",
    category: "fast",
  },
  {
    id: "@cf/meta/llama-3.1-8b-instruct-fp8",
    name: "Llama 3.1 8B (Fast FP8)",
    description: "Llama 3.1 8B quantized to FP8 precision for ultra-low latency edge responses",
    context_length: 131072,
    parameters: "8B FP8",
    category: "fast",
  },
];

const DEFAULT_MODEL_ID = "@cf/meta/llama-4-scout-17b-16e-instruct";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errorJson(message: string, status = 400, type = "invalid_request_error"): Response {
  return json({ error: { message, type, code: status } }, status);
}

function verifyAuth(req: Request, env: Env): boolean {
  if (!env.AUTH_TOKEN) return true;
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  return token === env.AUTH_TOKEN.trim();
}

function resolveModelId(requested?: string, defaultModel?: string): string {
  if (!requested) return defaultModel || DEFAULT_MODEL_ID;
  if (requested.startsWith("@cf/")) return requested;
  const match = SUPPORTED_MODELS.find((m) => m.id.includes(requested) || requested.includes(m.id));
  return match?.id || defaultModel || DEFAULT_MODEL_ID;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check & Info
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        service: "opendot-worker",
        status: "healthy",
        models: SUPPORTED_MODELS.length,
        default_model: env.DEFAULT_MODEL || DEFAULT_MODEL_ID,
      });
    }

    // Key verification endpoint
    if (url.pathname === "/v1/key" || url.pathname === "/v1/auth") {
      if (!verifyAuth(req, env)) {
        return errorJson("Invalid token", 401, "authentication_error");
      }
      return json({ valid: true, service: "opendot-worker" });
    }

    // Auth check for all /v1 endpoints
    if (!verifyAuth(req, env)) {
      return errorJson("Unauthorized: Invalid Bearer token", 401, "authentication_error");
    }

    // GET /v1/models
    if (url.pathname === "/v1/models" && req.method === "GET") {
      const data = SUPPORTED_MODELS.map((m) => ({
        id: m.id,
        object: "model",
        created: 1700000000,
        owned_by: "cloudflare",
        name: m.name,
        description: m.description,
        context_length: m.context_length,
        parameters: m.parameters,
        supported_parameters: ["tools", "stream", "temperature", "max_tokens"],
      }));
      return json({ object: "list", data });
    }

    // POST /v1/chat/completions
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        return await handleChatCompletions(body, env);
      } catch (err: any) {
        return errorJson(err?.message || "Failed to process chat completion", 500);
      }
    }

    // POST /v1/responses (OpenAI beta Responses API format used by OpenDot)
    if (url.pathname === "/v1/responses" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        return await handleResponses(body, env);
      } catch (err: any) {
        return errorJson(err?.message || "Failed to process response", 500);
      }
    }

    return errorJson(`Not Found: ${url.pathname}`, 404);
  },
};

// ============================================================================
// CHAT COMPLETIONS HANDLER
// ============================================================================

async function handleChatCompletions(body: any, env: Env): Promise<Response> {
  const model = resolveModelId(body.model, env.DEFAULT_MODEL);
  const { normalizedMessages, images } = processMessagesAndExtractImages(body.messages || []);
  const tools = normalizeTools(body.tools);
  const stream = Boolean(body.stream);

  const aiParams: any = {
    messages: normalizedMessages,
    max_tokens: body.max_tokens || 4096,
  };
  if (images.length > 0) {
    if (images[0].bytes) aiParams.image = images[0].bytes;
    else aiParams.image = images[0].url;
  }
  if (typeof body.temperature === "number") aiParams.temperature = body.temperature;
  if (tools && tools.length > 0) aiParams.tools = tools;

  const responseId = `chatcmpl-${crypto.randomUUID()}`;

  // If tools are provided, run non-streaming to guarantee clean tool call parsing
  if (!stream || (tools && tools.length > 0)) {
    const res = (await env.AI.run(model as any, aiParams)) as any;
    let content = res?.response || res?.content || "";
    if (typeof content === "string") {
      content = content.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
    }
    const toolCalls = res?.tool_calls || [];

    const choice: any = {
      index: 0,
      message: {
        role: "assistant",
        content: content || null,
      },
      finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
    };

    if (toolCalls.length > 0) {
      choice.message.tool_calls = toolCalls.map((t: any) => ({
        id: `call_${crypto.randomUUID().slice(0, 8)}`,
        type: "function",
        function: {
          name: t.name || t.function?.name,
          arguments: typeof t.arguments === "string" ? t.arguments : JSON.stringify(t.arguments || {}),
        },
      }));
    }

    return json({
      id: responseId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [choice],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

  // Pure text SSE Stream
  aiParams.stream = true;
  const aiStream = (await env.AI.run(model as any, aiParams)) as ReadableStream<Uint8Array>;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transformedStream = new ReadableStream({
    async start(controller) {
      const reader = aiStream.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;

            if (trimmed.startsWith("data:")) {
              const rawData = trimmed.slice(5).trim();
              if (rawData === "[DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                continue;
              }

              try {
                const parsed = JSON.parse(rawData);
                const chunkText = parsed.response || parsed.content || "";
                if (chunkText) {
                  const chunkObj = {
                    id: responseId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [
                      {
                        index: 0,
                        delta: { content: chunkText },
                        finish_reason: null,
                      },
                    ],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`));
                }
              } catch {
                // Ignore parse error
              }
            }
          }
        }

        const endChunk = {
          id: responseId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err: any) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(transformedStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...CORS_HEADERS,
    },
  });
}

// ============================================================================
// OPENAI RESPONSES API HANDLER (For OpenDot)
// ============================================================================

async function handleResponses(body: any, env: Env): Promise<Response> {
  const model = resolveModelId(body.model, env.DEFAULT_MODEL);
  const instructions = body.instructions || "";
  const input = body.input || [];
  const tools = normalizeTools(body.tools);
  const stream = Boolean(body.stream);

  const messages: any[] = [];
  if (instructions) {
    messages.push({ role: "system", content: instructions });
  }

  // Convert Responses input items to messages
  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
      } else if (item?.type === "message") {
        messages.push({
          role: item.role === "assistant" ? "assistant" : item.role === "system" ? "system" : "user",
          content: item.content,
        });
      } else if (item?.role) {
        messages.push({ role: item.role, content: item.content });
      } else if (item?.type === "function_call") {
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: item.call_id || `call_${crypto.randomUUID().slice(0, 8)}`,
              type: "function",
              function: {
                name: item.name,
                arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}),
              },
            },
          ],
        });
      } else if (item?.type === "function_call_output") {
        messages.push({
          role: "tool",
          name: item.call_id || "function_result",
          content: typeof item.output === "string" ? item.output : JSON.stringify(item.output || {}),
        });
      }
    }
  }

  const { normalizedMessages, images } = processMessagesAndExtractImages(messages);

  const aiParams: any = {
    messages: normalizedMessages,
    max_tokens: body.max_tokens || 4096,
  };
  if (images.length > 0) {
    if (images[0].bytes) aiParams.image = images[0].bytes;
    else aiParams.image = images[0].url;
  }
  if (typeof body.temperature === "number") aiParams.temperature = body.temperature;
  if (tools && tools.length > 0) aiParams.tools = tools;

  const responseId = `resp_${crypto.randomUUID().slice(0, 16)}`;
  const itemId = `msg_${crypto.randomUUID().slice(0, 16)}`;

  // When tools are present OR non-streaming, execute Workers AI directly
  if (!stream || (tools && tools.length > 0)) {
    const aiResult = (await env.AI.run(model as any, aiParams)) as any;
    let content = aiResult?.response || aiResult?.content || "";
    const toolCalls = aiResult?.tool_calls || [];

    const output: any[] = [];

    if (toolCalls && toolCalls.length > 0) {
      for (const t of toolCalls) {
        const callId = `call_${crypto.randomUUID().slice(0, 8)}`;
        const name = t.name || t.function?.name;
        const args = typeof t.arguments === "string" ? t.arguments : JSON.stringify(t.arguments || {});
        output.push({
          id: callId,
          type: "function_call",
          call_id: callId,
          name,
          arguments: args,
        });
      }
    } else {
      output.push({
        id: itemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "text", text: content }],
      });
    }

    if (!stream) {
      return json({
        id: responseId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model,
        output,
      });
    }

    // Stream SSE events for tool calls or immediate output
    const encoder = new TextEncoder();
    const immediateStream = new ReadableStream({
      start(controller) {
        // 1. response.created
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "response.created",
              response: { id: responseId, object: "response", status: "in_progress", model },
            })}\n\n`
          )
        );

        if (toolCalls && toolCalls.length > 0) {
          for (const o of output) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "response.output_item.added",
                  response_id: responseId,
                  output_index: 0,
                  item: { id: o.id, type: "function_call", call_id: o.call_id, name: o.name, arguments: "" },
                })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "response.function_call_arguments.delta",
                  response_id: responseId,
                  item_id: o.id,
                  output_index: 0,
                  call_id: o.call_id,
                  delta: o.arguments,
                })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "response.function_call_arguments.done",
                  response_id: responseId,
                  item_id: o.id,
                  output_index: 0,
                  call_id: o.call_id,
                  arguments: o.arguments,
                })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "response.output_item.done",
                  response_id: responseId,
                  output_index: 0,
                  item: o,
                })}\n\n`
              )
            );
          }
        } else {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "response.output_item.added",
                response_id: responseId,
                output_index: 0,
                item: { id: itemId, type: "message", role: "assistant", content: [] },
              })}\n\n`
            )
          );
          if (content) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "response.output_text.delta",
                  response_id: responseId,
                  item_id: itemId,
                  output_index: 0,
                  content_index: 0,
                  delta: content,
                })}\n\n`
              )
            );
          }
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "response.output_item.done",
                response_id: responseId,
                output_index: 0,
                item: {
                  id: itemId,
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "text", text: content }],
                },
              })}\n\n`
            )
          );
        }

        // Final response.completed
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "response.completed",
              response: {
                id: responseId,
                object: "response",
                status: "completed",
                model,
                output,
              },
            })}\n\n`
          )
        );
        controller.close();
      },
    });

    return new Response(immediateStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...CORS_HEADERS,
      },
    });
  }

  // Pure text token-by-token streaming
  aiParams.stream = true;
  const aiStream = (await env.AI.run(model as any, aiParams)) as ReadableStream<Uint8Array>;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transformedStream = new ReadableStream({
    async start(controller) {
      const reader = aiStream.getReader();
      let buffer = "";
      let fullContent = "";

      try {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "response.created",
              response: { id: responseId, object: "response", status: "in_progress", model },
            })}\n\n`
          )
        );

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "response.output_item.added",
              response_id: responseId,
              output_index: 0,
              item: { id: itemId, type: "message", role: "assistant", content: [] },
            })}\n\n`
          )
        );

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;

            if (trimmed.startsWith("data:")) {
              const rawData = trimmed.slice(5).trim();
              if (rawData === "[DONE]") continue;

              try {
                const parsed = JSON.parse(rawData);
                const chunkText = parsed.response || parsed.content || "";
                if (chunkText) {
                  fullContent += chunkText;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "response.output_text.delta",
                        response_id: responseId,
                        item_id: itemId,
                        output_index: 0,
                        content_index: 0,
                        delta: chunkText,
                      })}\n\n`
                    )
                  );
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        const cleanContent = fullContent.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "response.output_item.done",
              response_id: responseId,
              output_index: 0,
              item: {
                id: itemId,
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "text", text: cleanContent }],
              },
            })}\n\n`
          )
        );

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "response.completed",
              response: {
                id: responseId,
                object: "response",
                status: "completed",
                model,
                output: [
                  {
                    id: itemId,
                    type: "message",
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "text", text: cleanContent }],
                  },
                ],
              },
            })}\n\n`
          )
        );
      } catch (err: any) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(transformedStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...CORS_HEADERS,
    },
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function extractImageBytes(urlOrData: string): number[] | null {
  if (!urlOrData || typeof urlOrData !== "string") return null;
  const comma = urlOrData.indexOf(",");
  const b64 = comma !== -1 ? urlOrData.slice(comma + 1) : urlOrData;
  try {
    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return [...bytes];
  } catch {
    return null;
  }
}

function processMessagesAndExtractImages(messages: any[]): {
  normalizedMessages: any[];
  images: { url: string; bytes: number[] | null }[];
} {
  const images: { url: string; bytes: number[] | null }[] = [];

  const normalizedMessages = messages.map((m) => {
    let content = m.content;

    if (Array.isArray(content)) {
      const parts: any[] = [];
      const textPieces: string[] = [];

      for (const part of content) {
        if (typeof part === "string") {
          parts.push({ type: "text", text: part });
          textPieces.push(part);
          continue;
        }
        if (!part || typeof part !== "object") continue;

        // Image part detection
        let imgUrl = "";
        if (typeof part.image_url === "string") imgUrl = part.image_url;
        else if (part.image_url && typeof part.image_url.url === "string") imgUrl = part.image_url.url;
        else if (typeof part.image === "string") imgUrl = part.image;

        if (imgUrl) {
          const bytes = extractImageBytes(imgUrl);
          images.push({ url: imgUrl, bytes });
          parts.push({ type: "image_url", image_url: { url: imgUrl } });
          continue;
        }

        // Text part
        const txt = part.text || part.content || "";
        if (txt) {
          parts.push({ type: "text", text: txt });
          textPieces.push(txt);
        }
      }

      if (images.length === 0) {
        content = textPieces.join("\n");
      } else {
        content = parts;
      }
    }

    const item: any = {
      role: m.role || "user",
      content,
    };
    if (m.tool_calls) item.tool_calls = m.tool_calls;
    if (m.name) item.name = m.name;
    return item;
  });

  return { normalizedMessages, images };
}

function cleanParametersSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const cleaned: any = Array.isArray(schema) ? [] : {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue; // Strip additionalProperties for Workers AI C++ validator
    if (key === "type" && Array.isArray(value)) {
      // e.g. ["string", "null"] -> "string"
      cleaned[key] = value.find((v) => v !== "null") || value[0] || "string";
    } else if (typeof value === "object" && value !== null) {
      cleaned[key] = cleanParametersSchema(value);
    } else {
      cleaned[key] = value;
    }
  }
  if (!cleaned.type && !Array.isArray(cleaned)) {
    cleaned.type = "object";
  }
  return cleaned;
}

function normalizeTools(tools: any): any[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools
    .map((t) => {
      let fn = t.function || (t.type === "function" ? t : null);
      if (!fn && t.name) fn = t;
      if (!fn || !fn.name) return null;

      return {
        type: "function",
        function: {
          name: fn.name,
          description: fn.description || "",
          parameters: cleanParametersSchema(fn.parameters),
        },
      };
    })
    .filter(Boolean);
}

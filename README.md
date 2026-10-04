# OpenDot AI Worker (Cloudflare Workers AI)

High-performance, ultra-low latency OpenAI-compatible serverless AI endpoint for OpenDot.

## Models Included

* `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (70B parameters, 128k context)
* `@cf/qwen/qwen2.5-72b-instruct` (72B parameters, 32k context)
* `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` (32B parameters, 128k context)
* `@cf/meta/llama-3.1-8b-instruct` (8B parameters, 128k context)

## Quick Deploy

```bash
cd opendot-worker
npx wrangler deploy
```

Once deployed, copy your worker URL (e.g. `https://opendot-worker.<your-subdomain>.workers.dev`) and paste it into OpenDot **Settings -> Cloudflare Worker**.

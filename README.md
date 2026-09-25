# Rolled Up — Cloudflare version

This is the Cloudflare Workers + D1 version of Rolled Up. It does not depend on Floot.

## Architecture

- Cloudflare Worker: API routes + static asset hosting
- Cloudflare D1: 30-day ownership result cache
- OpenAI Responses API: live web research for ownership + local alternatives
- Static frontend: no framework/build step required

## One-time setup

1. Install dependencies:

   npm install

2. Sign in to Cloudflare:

   npx wrangler login

3. Create D1 and let Wrangler update `wrangler.jsonc` automatically:

   npm run db:create

   If Wrangler does not update the config automatically, copy the returned database id into `wrangler.jsonc` in place of `REPLACE_AFTER_D1_CREATE`.

4. Create the schema remotely:

   npm run db:migrate:remote

5. Add the OpenAI key securely:

   npx wrangler secret put OPENAI_API_KEY

   Paste it into Wrangler's secret prompt, never into source code.

6. Deploy:

   npm run deploy

7. Verify:

   - `/api/health` should return `{ "ok": true, ... }`
   - Search a known business with a city.
   - Repeat the exact search; the second ownership result should come from D1 cache.

## Custom domain

After the Worker deploys successfully, add `rolledup.org` in the Cloudflare dashboard as the Worker's custom domain. Do this only after the `*.workers.dev` deployment works.

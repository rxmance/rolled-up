const OWNERSHIP_LABELS = [
  "PRIVATE EQUITY",
  "PUBLIC COMPANY",
  "CORPORATE OWNED",
  "INDEPENDENT",
  "FAMILY OWNED",
  "EMPLOYEE OWNED",
  "FRANCHISE",
  "NONPROFIT / COOPERATIVE",
  "UNKNOWN"
];

const OWNERSHIP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    businessName: { type: "string" },
    locationLabel: { type: "string" },
    classification: { type: "string", enum: OWNERSHIP_LABELS },
    classificationDetail: { type: "string" },
    ownerChain: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["High", "Medium", "Low"] },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          publisher: { type: "string" },
          date: { type: "string" }
        },
        required: ["title", "url", "publisher", "date"]
      }
    }
  },
  required: [
    "businessName",
    "locationLabel",
    "classification",
    "classificationDetail",
    "ownerChain",
    "confidence",
    "sources"
  ]
};

const ALTERNATIVES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    alternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          reason: { type: "string" },
          location: { type: "string" },
          url: { type: "string" }
        },
        required: ["name", "reason", "location", "url"]
      }
    }
  },
  required: ["alternatives"]
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/research" && request.method === "POST") {
      return handleResearch(request, env);
    }

    if (
      url.pathname === "/api/alternatives" &&
      request.method === "POST"
    ) {
      return handleAlternatives(request, env);
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "rolled-up",
        version: "cloudflare-v2"
      });
    }

    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};

async function handleResearch(request, env) {
  try {
    const input = await request.json();

    const query = cleanString(input.query, 160);
    const city = cleanString(input.city, 120);
    const latitude = finiteNumber(input.latitude);
    const longitude = finiteNumber(input.longitude);

    if (!query) {
      return json(
        { error: "Enter a business, brand, product, or service." },
        400
      );
    }

    const apiKey = await getOpenAIKey(env);

    if (!apiKey) {
      return json(
        { error: "OpenAI API key is not configured." },
        500
      );
    }

    if (!env.DB) {
      return json(
        { error: "Database is not configured." },
        500
      );
    }

    const cacheKey = makeCacheKey(
      query,
      city,
      latitude,
      longitude
    );

    const cached = await env.DB.prepare(
      "SELECT result_json, expires_at FROM ownership_cache WHERE cache_key = ?"
    )
      .bind(cacheKey)
      .first();

    if (
      cached &&
      Date.parse(cached.expires_at) > Date.now()
    ) {
      return json({
        ...JSON.parse(cached.result_json),
        cached: true
      });
    }

    const locationContext = city
      ? `User location: ${city}.`
      : latitude != null && longitude != null
        ? `Approximate coordinates: ${latitude}, ${longitude}.`
        : "No location was supplied. Do not infer a location unless the business itself clearly identifies one.";

    const prompt = `Research the CURRENT ownership of "${query}" for Rolled Up, a consumer ownership-transparency product.

${locationContext}

Classify the business into ONE consumer-useful ownership type:

- PRIVATE EQUITY: current PE fund/sponsor ownership, control, or meaningful PE backing.
- PUBLIC COMPANY: ultimately controlled by a publicly traded company.
- CORPORATE OWNED: part of a large privately held corporation or conglomerate. Example: VCA is CORPORATE OWNED because it is part of Mars, even though Mars is family-controlled.
- INDEPENDENT: directly founder/owner operated and not part of a larger corporate group.
- FAMILY OWNED: the searched business itself is directly family-owned/operated or is a small-to-midsize family enterprise. Do NOT use this for a brand/subsidiary inside a giant corporate group.
- EMPLOYEE OWNED: employee-owned/ESOP.
- FRANCHISE: the relevant local business is a franchise and that distinction is more useful than the franchisor's ownership.
- NONPROFIT / COOPERATIVE.
- UNKNOWN when evidence is insufficient or conflicting.

Rules:
1. Focus on CURRENT ownership, not historical transactions.
2. Trace the ownership chain to the ultimate owner/sponsor.
3. Prefer official company/IR pages, SEC filings, acquisition announcements, PE portfolio pages, and reputable financial/business reporting.
4. Return 2-5 direct evidence URLs. Never invent URLs.
5. Keep classificationDetail to 1-3 short sentences, written for a normal consumer.
6. Be neutral and factual.`;

    const result = await openAIJson(apiKey, {
      model: "gpt-4.1-mini",
      input: prompt,
      tools: [
        {
          type: "web_search",
          search_context_size: "low"
        }
      ],
      max_output_tokens: 1000,
      text: {
        format: {
          type: "json_schema",
          name: "ownership_result",
          strict: true,
          schema: OWNERSHIP_SCHEMA
        }
      }
    });

    const cleaned = sanitizeOwnershipResult(
      result,
      query,
      city
    );

    const researchedAt = new Date().toISOString();

    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    const finalResult = {
      ...cleaned,
      researchedAt,
      cached: false
    };

    await env.DB.prepare(`
      INSERT INTO ownership_cache
        (
          cache_key,
          business_name,
          location_key,
          result_json,
          researched_at,
          expires_at
        )
      VALUES (?, ?, ?, ?, ?, ?)

      ON CONFLICT(cache_key) DO UPDATE SET
        business_name = excluded.business_name,
        location_key = excluded.location_key,
        result_json = excluded.result_json,
        researched_at = excluded.researched_at,
        expires_at = excluded.expires_at
    `)
      .bind(
        cacheKey,
        finalResult.businessName,
        locationKey(city, latitude, longitude),
        JSON.stringify(finalResult),
        researchedAt,
        expiresAt
      )
      .run();

    return json(finalResult);
  } catch (error) {
    console.error(
      "research_error",
      safeError(error)
    );

    return json(
      {
        error:
          "We couldn't complete that ownership search. Try again."
      },
      500
    );
  }
}

async function handleAlternatives(request, env) {
  try {
    const input = await request.json();

    const businessName = cleanString(
      input.businessName,
      160
    );

    const city = cleanString(input.city, 120);

    const latitude = finiteNumber(input.latitude);
    const longitude = finiteNumber(input.longitude);

    if (!businessName) {
      return json({ alternatives: [] });
    }

    if (
      !city &&
      (latitude == null || longitude == null)
    ) {
      return json({ alternatives: [] });
    }

    const apiKey = await getOpenAIKey(env);

    if (!apiKey) {
      return json({ alternatives: [] });
    }

    const place =
      city || `${latitude}, ${longitude}`;

    const prompt = `Find up to 3 genuinely local independent alternatives to "${businessName}" near ${place}.

First infer the practical business category.

Then find nearby businesses in the same practical category.

Prefer businesses that are:
- independently owned
- founder-owned
- family-owned
- employee-owned
- cooperative
- locally owned

Avoid:
- national chains
- franchises
- large corporate groups
- private-equity-backed rollups

For each option, verify local/independent ownership using credible public evidence such as:
- the business's About page
- founder biography
- local reporting
- ownership disclosure

If you cannot verify ownership, omit it.

Use an official or credible source URL.

Keep the reason short and consumer-friendly.`;

    const result = await openAIJson(apiKey, {
      model: "gpt-4.1-mini",
      input: prompt,
      tools: [
        {
          type: "web_search",
          search_context_size: "low"
        }
      ],
      max_output_tokens: 800,
      text: {
        format: {
          type: "json_schema",
          name: "local_alternatives",
          strict: true,
          schema: ALTERNATIVES_SCHEMA
        }
      }
    });

    const alternatives = Array.isArray(
      result.alternatives
    )
      ? result.alternatives
          .slice(0, 3)
          .map(item => ({
            name: cleanString(item.name, 160),
            reason: cleanString(
              item.reason,
              320
            ),
            location: cleanString(
              item.location,
              200
            ),
            url: validHttpUrl(item.url)
              ? item.url
              : ""
          }))
          .filter(
            item =>
              item.name &&
              item.reason
          )
      : [];

    return json({ alternatives });
  } catch (error) {
    console.error(
      "alternatives_error",
      safeError(error)
    );

    return json({ alternatives: [] });
  }
}

async function getOpenAIKey(env) {
  const binding = env.OPENAI_API_KEY;

  if (!binding) {
    return "";
  }

  if (typeof binding === "string") {
    return binding;
  }

  if (
    binding &&
    typeof binding.get === "function"
  ) {
    const value = await binding.get();

    return typeof value === "string"
      ? value
      : "";
  }

  return "";
}

async function openAIJson(apiKey, body) {
  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    console.error(
      "openai_error",
      response.status,
      detail.slice(0, 1200)
    );

    throw new Error(
      `OpenAI ${response.status}`
    );
  }

  const payload = await response.json();

  const outputText =
    getOutputText(payload);

  if (!outputText) {
    throw new Error(
      "OpenAI returned no structured result"
    );
  }

  return JSON.parse(outputText);
}

function getOutputText(payload) {
  if (
    typeof payload?.output_text ===
    "string"
  ) {
    return payload.output_text;
  }

  let text = "";

  for (
    const item of payload?.output || []
  ) {
    for (
      const part of item?.content || []
    ) {
      if (
        part?.type === "output_text" &&
        typeof part.text === "string"
      ) {
        text += part.text;
      }
    }
  }

  return text;
}

function sanitizeOwnershipResult(
  result,
  query,
  city
) {
  const classification =
    OWNERSHIP_LABELS.includes(
      result.classification
    )
      ? result.classification
      : "UNKNOWN";

  const sources = Array.isArray(
    result.sources
  )
    ? result.sources
        .filter(
          source =>
            source &&
            validHttpUrl(source.url)
        )
        .slice(0, 5)
        .map(source => ({
          title:
            cleanString(
              source.title,
              240
            ) || source.url,

          url: source.url,

          publisher: cleanString(
            source.publisher,
            120
          ),

          date: cleanString(
            source.date,
            80
          )
        }))
    : [];

  return {
    businessName:
      cleanString(
        result.businessName,
        180
      ) || query,

    locationLabel:
      cleanString(
        result.locationLabel,
        160
      ) ||
      city ||
      "",

    classification: sources.length
      ? classification
      : "UNKNOWN",

    classificationDetail:
      sources.length
        ? cleanString(
            result.classificationDetail,
            700
          )
        : "We couldn't find enough current, sourceable ownership evidence to classify this business confidently.",

    ownerChain: Array.isArray(
      result.ownerChain
    )
      ? result.ownerChain
          .map(x =>
            cleanString(x, 180)
          )
          .filter(Boolean)
          .slice(0, 8)
      : [query],

    confidence:
      sources.length &&
      ["High", "Medium", "Low"].includes(
        result.confidence
      )
        ? result.confidence
        : "Low",

    sources
  };
}

function makeCacheKey(
  query,
  city,
  latitude,
  longitude
) {
  return `v2::${query
    .trim()
    .toLowerCase()}::${locationKey(
    city,
    latitude,
    longitude
  )}`;
}

function locationKey(
  city,
  latitude,
  longitude
) {
  if (city) {
    return city.trim().toLowerCase();
  }

  if (
    latitude != null &&
    longitude != null
  ) {
    return `${latitude.toFixed(
      2
    )},${longitude.toFixed(2)}`;
  }

  return "none";
}

function cleanString(
  value,
  max = 500
) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, max);
}

function finiteNumber(value) {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

function validHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" ||
      url.protocol === "http:"
    );
  } catch {
    return false;
  }
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

function safeError(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}

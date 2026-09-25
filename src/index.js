const OWNERSHIP_LABELS = [
  "PRIVATE EQUITY",
  "VENTURE BACKED",
  "PUBLIC COMPANY",
  "CORPORATE OWNED",
  "RESTAURANT / HOSPITALITY GROUP",
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
    classification: {
      type: "string",
      enum: OWNERSHIP_LABELS
    },
    classificationDetail: { type: "string" },
    ownerChain: {
      type: "array",
      items: { type: "string" }
    },
    moneyRaised: { type: "string" },
    keyInvestors: {
      type: "array",
      items: { type: "string" }
    },
    relatedBusinesses: {
      type: "array",
      items: { type: "string" }
    },
    founderOperator: { type: "string" },
    confidence: {
      type: "string",
      enum: ["High", "Medium", "Low"]
    },
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
        required: [
          "title",
          "url",
          "publisher",
          "date"
        ]
      }
    }
  },
  required: [
    "businessName",
    "locationLabel",
    "classification",
    "classificationDetail",
    "ownerChain",
    "moneyRaised",
    "keyInvestors",
    "relatedBusinesses",
    "founderOperator",
    "confidence",
    "sources"
  ]
};

const ALTERNATIVES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string" },
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
        required: [
          "name",
          "reason",
          "location",
          "url"
        ]
      }
    }
  },
  required: [
    "category",
    "alternatives"
  ]
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === "/api/research" &&
      request.method === "POST"
    ) {
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
        version: "cloudflare-v3"
      });
    }

    if (
      env.ASSETS &&
      typeof env.ASSETS.fetch === "function"
    ) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", {
      status: 404
    });
  }
};

async function handleResearch(request, env) {
  try {
    const input = await request.json();

    const query = cleanString(
      input.query,
      160
    );

    const city = cleanString(
      input.city,
      120
    );

    const latitude = finiteNumber(
      input.latitude
    );

    const longitude = finiteNumber(
      input.longitude
    );

    if (!query) {
      return json(
        {
          error:
            "Enter a business, brand, product, or service."
        },
        400
      );
    }

    const apiKey =
      await getOpenAIKey(env);

    if (!apiKey) {
      return json(
        {
          error:
            "OpenAI API key is not configured."
        },
        500
      );
    }

    if (!env.DB) {
      return json(
        {
          error:
            "Database is not configured."
        },
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
      Date.parse(cached.expires_at) >
        Date.now()
    ) {
      return json({
        ...JSON.parse(
          cached.result_json
        ),
        cached: true
      });
    }

    const locationContext = city
      ? `User location: ${city}.`
      : latitude != null &&
          longitude != null
        ? `Approximate coordinates: ${latitude}, ${longitude}.`
        : "No location was supplied. Do not infer a location unless the business itself clearly identifies one.";

    const prompt = `
Research the CURRENT ownership, financial backing, and business relationships of "${query}" for Rolled Up, a consumer ownership-transparency product.

${locationContext}

THE GOAL:

Tell a normal consumer who is really behind this business.

Do not stop at the founder, chef, CEO, local operator, or public-facing brand story.

Actively investigate whether there are investors, parent companies, restaurant groups, holding companies, acquisition vehicles, private-equity sponsors, venture-capital firms, strategic investors, franchise relationships, or other businesses controlled by the same owners.

CLASSIFY INTO EXACTLY ONE:

PRIVATE EQUITY
Current private-equity fund/sponsor ownership, control, or meaningful PE backing.

VENTURE BACKED
A privately held company with meaningful institutional venture-capital or similar outside equity investment. A venture-backed company should NOT be classified as Independent merely because it remains privately held.

PUBLIC COMPANY
Ultimately controlled by a publicly traded company.

CORPORATE OWNED
Part of a substantial privately held corporation, conglomerate, multi-brand company, or other larger corporate enterprise. Example: VCA is Corporate Owned because it is owned by Mars.

RESTAURANT / HOSPITALITY GROUP
A restaurant, bar, hotel, or hospitality business that is part of a multi-concept or multi-location ownership/operator network. This category may apply even when the group itself is privately held and not widely publicized.

INDEPENDENT
Use this ONLY when there is affirmative evidence that the business is directly founder-, individual-, or locally owned and operated AND there is no evidence of a larger parent, institutional investors, venture backing, private equity, substantial multi-brand group, or corporate ownership.

Being privately held does NOT automatically mean Independent.

Not finding a parent company does NOT automatically mean Independent.

FAMILY OWNED
The searched business itself is directly family-owned/operated or is a small-to-midsize family enterprise. Do not use this merely because the ultimate owner of a giant corporation is a family.

EMPLOYEE OWNED
Employee-owned, worker-owned, or ESOP.

FRANCHISE
The relevant local business is a franchise and that relationship is the most useful ownership fact for the consumer.

NONPROFIT / COOPERATIVE
A nonprofit organization, cooperative, or similar structure.

UNKNOWN
Use when current ownership cannot be established confidently from credible public evidence.

RESEARCH PROCESS:

Before assigning a classification, investigate as many of these as relevant:

1. "${query}" owner
2. "${query}" ownership
3. "${query}" parent company
4. "${query}" acquired
5. "${query}" acquisition
6. "${query}" funding
7. "${query}" investors
8. "${query}" venture capital
9. "${query}" private equity
10. "${query}" restaurant group
11. "${query}" hospitality group
12. "${query}" partners
13. "${query}" founder
14. "${query}" operator

Then follow the people and entities you discover.

For example, if an owner or investor is identified, investigate that person's or entity's other businesses and determine whether the searched business is actually part of a larger network.

For restaurants and hospitality businesses especially, look for:
- shared owners
- operating companies
- restaurant groups
- holding companies
- sibling restaurants
- repeated business partners
- management companies
- LLC ownership when credible reporting connects it to people or groups

Do NOT confuse:
- chef with owner
- founder with current owner
- CEO with owner
- operator with ultimate owner
- "privately held" with "independent"

FUNDING:

If credible sources report outside funding, return the best-supported total in moneyRaised.

Examples:
"$28.7M raised"
"$100M Series B; total funding unclear"
"Undisclosed growth investment"

If no credible funding figure is found, return an empty string.

INVESTORS:

Return the most important current or historically relevant institutional investors when they help explain who financially backs the company.

Do not clutter the result with every small investor.

RELATED BUSINESSES:

Return sibling brands, restaurants, concepts, or businesses connected through the same ownership/operator group when this relationship is useful to understanding the business.

Do not list speculative connections.

FOUNDER / OPERATOR:

Return the founder, chef, CEO, or operator only when useful, but keep this separate from actual ownership.

EVIDENCE RULES:

1. Focus on CURRENT ownership.
2. Trace ownership as far toward the ultimate owner, sponsor, investors, or controlling group as credible evidence allows.
3. Prefer official company pages, SEC filings, acquisition announcements, investor portfolio pages, funding announcements, and reputable business or local reporting.
4. For deliberately opaque private businesses, reputable local reporting connecting the same owners to multiple businesses is useful evidence.
5. Return 2-5 direct evidence URLs.
6. Never invent a URL.
7. If evidence is incomplete, say so.
8. UNKNOWN is better than falsely calling a business Independent.
9. Do not imply a person or firm controls the business merely because they invested in it unless the evidence supports control.
10. Keep classificationDetail VERY SHORT: ideally 1-2 sentences.
11. Write for a normal consumer, not an investor.
12. Be neutral and factual.
`;

    const result =
      await openAIJson(apiKey, {
        model: "gpt-4.1-mini",
        input: prompt,
        tools: [
          {
            type: "web_search",
            search_context_size:
              "medium"
          }
        ],
        max_output_tokens: 1400,
        text: {
          format: {
            type: "json_schema",
            name: "ownership_result",
            strict: true,
            schema: OWNERSHIP_SCHEMA
          }
        }
      });

    const cleaned =
      sanitizeOwnershipResult(
        result,
        query,
        city
      );

    const researchedAt =
      new Date().toISOString();

    const expiresAt =
      new Date(
        Date.now() +
          30 *
            24 *
            60 *
            60 *
            1000
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
        locationKey(
          city,
          latitude,
          longitude
        ),
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

async function handleAlternatives(
  request,
  env
) {
  try {
    const input =
      await request.json();

    const businessName =
      cleanString(
        input.businessName,
        160
      );

    const city =
      cleanString(
        input.city,
        120
      );

    const latitude =
      finiteNumber(
        input.latitude
      );

    const longitude =
      finiteNumber(
        input.longitude
      );

    if (!businessName) {
      return json({
        alternatives: []
      });
    }

    if (
      !city &&
      (
        latitude == null ||
        longitude == null
      )
    ) {
      return json({
        alternatives: []
      });
    }

    const apiKey =
      await getOpenAIKey(env);

    if (!apiKey) {
      return json({
        alternatives: []
      });
    }

    const place =
      city ||
      `${latitude}, ${longitude}`;

    const prompt = `
Find up to 3 genuinely local, independently owned alternatives to "${businessName}" near ${place}.

CATEGORY MATCHING IS MANDATORY.

STEP 1:
Identify what "${businessName}" actually is from the consumer's perspective.

Examples:
- Italian restaurant
- coffee shop
- women's health clinic
- veterinary clinic
- grocery store
- clothing store
- hotel
- gym
- pharmacy
- pizza restaurant
- beauty salon

STEP 2:
Find alternatives that provide substantially the SAME PRIMARY PRODUCT OR SERVICE.

A restaurant must return restaurants.

A veterinary clinic must return veterinary clinics.

A women's healthcare clinic must return comparable women's healthcare or medical providers.

A clothing retailer must return clothing retailers.

A coffee shop must return coffee shops or genuinely comparable cafes.

Do NOT recommend a business merely because it is nearby.

Do NOT cross into unrelated industries.

If you cannot find a good same-category independent alternative, return fewer than 3 results or none.

OWNERSHIP:

Prefer:
- independently owned
- founder-owned
- family-owned
- employee-owned
- cooperative
- genuinely locally owned

Avoid:
- national chains
- franchises
- large restaurant groups
- large hospitality groups
- corporate subsidiaries
- venture-backed chains
- private-equity-backed rollups

For EACH recommendation, verify independent/local ownership using credible public evidence such as:
- official About page
- founder biography
- local reporting
- ownership disclosure

If you cannot reasonably verify ownership, omit the business.

LOCATION:

The business should genuinely serve the user's supplied area.

Prioritize the same neighborhood or city.

Do not substitute a similarly named city in another state.

If the user supplies a ZIP code, treat that ZIP code as strong geographic evidence.

OUTPUT:

Return the practical category in "category".

Return no more than 3 alternatives.

Keep each reason to ONE short sentence explaining both:
1. why it is comparable
2. why it appears independently/local owned

Use an official or credible URL.

Accuracy is more important than returning 3 results.
`;

    const result =
      await openAIJson(apiKey, {
        model: "gpt-4.1-mini",
        input: prompt,
        tools: [
          {
            type: "web_search",
            search_context_size:
              "medium"
          }
        ],
        max_output_tokens: 900,
        text: {
          format: {
            type: "json_schema",
            name:
              "local_alternatives",
            strict: true,
            schema:
              ALTERNATIVES_SCHEMA
          }
        }
      });

    const alternatives =
      Array.isArray(
        result.alternatives
      )
        ? result.alternatives
            .slice(0, 3)
            .map(item => ({
              name: cleanString(
                item.name,
                160
              ),

              reason: cleanString(
                item.reason,
                320
              ),

              location:
                cleanString(
                  item.location,
                  200
                ),

              url:
                validHttpUrl(
                  item.url
                )
                  ? item.url
                  : ""
            }))
            .filter(
              item =>
                item.name &&
                item.reason
            )
        : [];

    return json({
      category:
        cleanString(
          result.category,
          120
        ),
      alternatives
    });
  } catch (error) {
    console.error(
      "alternatives_error",
      safeError(error)
    );

    return json({
      alternatives: []
    });
  }
}

async function getOpenAIKey(env) {
  const binding =
    env.OPENAI_API_KEY;

  if (!binding) {
    return "";
  }

  if (
    typeof binding === "string"
  ) {
    return binding;
  }

  if (
    binding &&
    typeof binding.get ===
      "function"
  ) {
    const value =
      await binding.get();

    return typeof value ===
      "string"
      ? value
      : "";
  }

  return "";
}

async function openAIJson(
  apiKey,
  body
) {
  const response =
    await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${apiKey}`
        },
        body:
          JSON.stringify(body)
      }
    );

  if (!response.ok) {
    const detail =
      await response.text();

    console.error(
      "openai_error",
      response.status,
      detail.slice(0, 1200)
    );

    throw new Error(
      `OpenAI ${response.status}`
    );
  }

  const payload =
    await response.json();

  const outputText =
    getOutputText(payload);

  if (!outputText) {
    throw new Error(
      "OpenAI returned no structured result"
    );
  }

  return JSON.parse(
    outputText
  );
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
    const item of
      payload?.output || []
  ) {
    for (
      const part of
        item?.content || []
    ) {
      if (
        part?.type ===
          "output_text" &&
        typeof part.text ===
          "string"
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

  const sources =
    Array.isArray(
      result.sources
    )
      ? result.sources
          .filter(
            source =>
              source &&
              validHttpUrl(
                source.url
              )
          )
          .slice(0, 5)
          .map(source => ({
            title:
              cleanString(
                source.title,
                240
              ) ||
              source.url,

            url: source.url,

            publisher:
              cleanString(
                source.publisher,
                120
              ),

            date:
              cleanString(
                source.date,
                80
              )
          }))
      : [];

  const keyInvestors =
    Array.isArray(
      result.keyInvestors
    )
      ? result.keyInvestors
          .map(item =>
            cleanString(
              item,
              160
            )
          )
          .filter(Boolean)
          .slice(0, 6)
      : [];

  const relatedBusinesses =
    Array.isArray(
      result.relatedBusinesses
    )
      ? result.relatedBusinesses
          .map(item =>
            cleanString(
              item,
              160
            )
          )
          .filter(Boolean)
          .slice(0, 6)
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

    classification:
      sources.length
        ? classification
        : "UNKNOWN",

    classificationDetail:
      sources.length
        ? cleanString(
            result.classificationDetail,
            420
          )
        : "We couldn't find enough current, sourceable ownership evidence to classify this business confidently.",

    ownerChain:
      Array.isArray(
        result.ownerChain
      )
        ? result.ownerChain
            .map(item =>
              cleanString(
                item,
                180
              )
            )
            .filter(Boolean)
            .slice(0, 8)
        : [query],

    moneyRaised:
      cleanString(
        result.moneyRaised,
        160
      ),

    keyInvestors,

    relatedBusinesses,

    founderOperator:
      cleanString(
        result.founderOperator,
        220
      ),

    confidence:
      sources.length &&
      [
        "High",
        "Medium",
        "Low"
      ].includes(
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
  return `v3::${query
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
    return city
      .trim()
      .toLowerCase();
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
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(0, max);
}

function finiteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  )
    ? value
    : null;
}

function validHttpUrl(value) {
  if (
    typeof value !== "string"
  ) {
    return false;
  }

  try {
    const url =
      new URL(value);

    return (
      url.protocol ===
        "https:" ||
      url.protocol ===
        "http:"
    );
  } catch {
    return false;
  }
}

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
}

function safeError(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}

import OpenAI from "openai";
import { z } from "zod";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import type { RecognitionInput, RecognitionProvider } from "./types.js";

const conditions = ["new", "open_box", "like_new", "excellent", "good", "fair", "poor", "for_parts", "unknown"] as const;
const categories = ["electronics", "gaming_consoles", "collectibles", "trading_cards", "clothing", "shoes", "accessories", "tools", "furniture", "other"] as const;

const ParsedCandidate = z.object({
  title: z.string().min(1),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  category: z.enum(categories),
  condition: z.enum(conditions),
  confidence: z.number().min(0).max(1),
  attributes: z.array(z.object({ key: z.string(), value: z.string() })),
  accessories_seen: z.array(z.string()),
  uncertainties: z.array(z.string()),
});

const ParsedResponse = z.object({ candidates: z.array(ParsedCandidate).min(1).max(3) });

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "brand", "model", "category", "condition", "confidence", "attributes", "accessories_seen", "uncertainties"],
        properties: {
          title: { type: "string" },
          brand: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          category: { type: "string", enum: categories },
          condition: { type: "string", enum: conditions },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          attributes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value"],
              properties: { key: { type: "string" }, value: { type: "string" } },
            },
          },
          accessories_seen: { type: "array", items: { type: "string" } },
          uncertainties: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export class OpenAIRecognitionProvider implements RecognitionProvider {
  private readonly client: OpenAI;

  constructor() {
    if (!env.OPENAI_API_KEY) throw new ApiError(500, "provider_not_configured", "OPENAI_API_KEY is required when RECOGNITION_PROVIDER=openai.");
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  async identify(input: RecognitionInput) {
    // Photo 1 is the required primary view, so keep adaptive detail there. Extra
    // angles are supporting evidence and can use low detail to cut vision tokens
    // substantially without discarding the multi-angle signal.
    const imageParts = input.imageUrls.slice(0, 3).map((imageUrl, index) => ({
      type: "input_image" as const,
      image_url: imageUrl,
      detail: index === 0 ? "auto" as const : "low" as const,
    }));

    const context = [
      input.barcode ? `Barcode: ${input.barcode}` : null,
      input.categoryHint ? `Category hint: ${input.categoryHint}` : null,
    ].filter(Boolean).join("\n");

    const response = await this.client.responses.create({
      model: env.OPENAI_MODEL,
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: "Identify the resale item shown across the supplied photos. Treat all photos as views of one main item unless clearly different. Return up to 3 ranked candidates. Choose the best category from electronics, gaming_consoles, collectibles, trading_cards, clothing, shoes, accessories, tools, furniture, other. Never invent model, serial, authenticity, condition, size, capacity, colorway, material, edition, or accessories. Keep title concise/search-friendly. Put only visually supported variant details in attributes; uncertain details go in uncertainties. Prioritize brand, model/style, storage/capacity, size, color/colorway, material, edition and visible identifiers.",
          }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: `Identify this item for resale-market search.${context ? `\n${context}` : ""}` },
            ...imageParts,
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "worth_it_item_candidates", strict: true, schema: responseSchema } },
    });

    if (!response.output_text) throw new ApiError(502, "recognition_empty_response", "The recognition provider returned no structured output.", true);
    let json: unknown;
    try { json = JSON.parse(response.output_text); }
    catch { throw new ApiError(502, "recognition_invalid_response", "The recognition provider returned invalid JSON.", true); }
    const parsed = ParsedResponse.parse(json);

    return parsed.candidates.map((candidate, index) => ({
      candidateKey: `openai:${input.scanId}:${index + 1}`,
      title: candidate.title,
      brand: candidate.brand,
      model: candidate.model,
      category: candidate.category,
      condition: candidate.condition,
      confidence: candidate.confidence,
      attributes: Object.fromEntries(candidate.attributes.map(({ key, value }) => [key, value])),
      accessoriesSeen: candidate.accessories_seen,
      uncertainties: candidate.uncertainties,
      provider: "openai",
      providerModel: env.OPENAI_MODEL,
      promptVersion: "recognition-v1.4-cost-optimized",
    }));
  }
}

import type { RecognitionInput, RecognitionProvider } from "./types.js";

export class MockRecognitionProvider implements RecognitionProvider {
  async identify(input: RecognitionInput) {
    const category = input.categoryHint ?? "electronics";
    return [
      {
        candidateKey: `mock:${input.scanId}:1`,
        title: "Sample item for local development",
        brand: "Sample Brand",
        model: "DEV-001",
        category,
        condition: "good" as const,
        confidence: 0.91,
        attributes: { mode: "mock", image_count: input.imageUrls.length },
        accessoriesSeen: [],
        uncertainties: ["Mock recognition is enabled; this is not a real identification."],
        provider: "mock",
        providerModel: null,
        promptVersion: "mock-v1",
      },
    ];
  }
}

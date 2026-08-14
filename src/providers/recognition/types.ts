import type { Database, Json } from "../../database.types.js";

export type ItemCondition = Database["public"]["Enums"]["item_condition"];

export type RecognitionCandidate = {
  candidateKey: string;
  title: string;
  brand: string | null;
  model: string | null;
  category: string;
  condition: ItemCondition;
  confidence: number;
  attributes: Json;
  accessoriesSeen: string[];
  uncertainties: string[];
  provider: string;
  providerModel: string | null;
  promptVersion: string;
};

export type RecognitionInput = {
  scanId: string;
  imageUrls: string[];
  barcode?: string;
  categoryHint?: string | null;
};

export interface RecognitionProvider {
  identify(input: RecognitionInput): Promise<RecognitionCandidate[]>;
}

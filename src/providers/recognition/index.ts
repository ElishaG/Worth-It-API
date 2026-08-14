import { env } from "../../config/env.js";
import { MockRecognitionProvider } from "./mock.js";
import { OpenAIRecognitionProvider } from "./openai.js";
import type { RecognitionProvider } from "./types.js";

export function createRecognitionProvider(): RecognitionProvider {
  return env.RECOGNITION_PROVIDER === "openai"
    ? new OpenAIRecognitionProvider()
    : new MockRecognitionProvider();
}

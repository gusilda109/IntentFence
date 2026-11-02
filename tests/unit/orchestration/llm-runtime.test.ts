import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientOptions: vi.fn(),
  setClient: vi.fn(),
  setApi: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("openai", () => ({
  default: class OpenAI {
    constructor(options: unknown) {
      mocks.clientOptions(options);
    }
  },
}));

vi.mock("@openai/agents", () => ({
  setDefaultOpenAIClient: mocks.setClient,
  setOpenAIAPI: mocks.setApi,
}));

import { configureLiveLlm } from "@/server/llm-runtime";

describe("Live LLM runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://llm.example.test/api");
    vi.stubEnv("OPENAI_MODEL_ACTOR", "test-actor-model");
    vi.stubEnv("OPENAI_MODEL_SUPERVISOR", "test-supervisor-model");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("configures an OpenAI-compatible Chat Completions endpoint", () => {
    const config = configureLiveLlm();

    expect(mocks.clientOptions).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "https://llm.example.test/api",
    });
    expect(mocks.setClient).toHaveBeenCalledOnce();
    expect(mocks.setApi).toHaveBeenCalledWith("chat_completions");
    expect(config).toEqual({
      actorModel: "test-actor-model",
      supervisorModel: "test-supervisor-model",
    });
  });

  it("fails closed before agent execution when the key is missing", () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(() => configureLiveLlm()).toThrow("OPENAI_API_KEY is required in Live mode");
    expect(mocks.clientOptions).not.toHaveBeenCalled();
    expect(mocks.setApi).not.toHaveBeenCalled();
  });

  it("does not put endpoint or credentials into the returned agent config", () => {
    const config = configureLiveLlm();

    expect(config).not.toHaveProperty("apiKey");
    expect(config).not.toHaveProperty("baseURL");
    expect(JSON.stringify(config)).not.toContain("test-key");
    expect(JSON.stringify(config)).not.toContain("llm.example.test");
  });
});

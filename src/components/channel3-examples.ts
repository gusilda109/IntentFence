import type { Verdict } from "@/shared/contracts";

export interface Channel3Example {
  id: string;
  label: string;
  goal: string;
  budget: string;
  expectedVerdict: Verdict["decision"];
  requiresLive?: boolean;
  requiresReplay?: boolean;
  constraints: Array<{
    text: string;
    enforcement: "hard" | "soft";
  }>;
}

export const CHANNEL3_EXAMPLES: readonly Channel3Example[] = [
  {
    id: "home-office-mouse",
    label: "Home office mouse · ALLOW",
    goal: "I need a wireless mouse for my home office",
    budget: "50",
    expectedVerdict: "ALLOW",
    constraints: [
      {
        text: "It must be a wireless mouse that works with a standard laptop.",
        enforcement: "hard",
      },
      {
        text: "I’d prefer something comfortable for long work sessions, not a gaming mouse.",
        enforcement: "soft",
      },
    ],
  },
  {
    id: "home-podcast-microphone",
    label: "Podcast starter · PARTIAL_ALLOW",
    goal: "I’m setting up a small home podcast and need a microphone and headphones for recording and monitoring.",
    budget: "250",
    expectedVerdict: "PARTIAL_ALLOW",
    constraints: [
      {
        text: "Both the microphone and headphones are essential. Don’t add an audio interface, mixer, or subscription.",
        enforcement: "hard",
      },
      {
        text: "A simple USB microphone would be ideal. A pop filter is a nice-to-have, not essential.",
        enforcement: "soft",
      },
    ],
  },
  {
    id: "college-laptop-requirements",
    label: "College laptop guard · BLOCK · Live",
    goal: "I want to buy an Apple MacBook Air M1 for my college coursework",
    budget: "1000",
    expectedVerdict: "BLOCK",
    requiresLive: true,
    constraints: [
      {
        text: "My coursework requires at least 32 GB of RAM. Models with 8 GB or 16 GB won’t work for me.",
        enforcement: "hard",
      },
      {
        text: "I’d prefer a smaller laptop that’s easy to carry to class.",
        enforcement: "soft",
      },
    ],
  },
  {
    id: "unclear-online-audio",
    label: "Open-ended audio · REVIEW",
    goal: "Make voices sound less muffled when I speak online",
    budget: "150",
    expectedVerdict: "REVIEW",
    constraints: [
      {
        text: "I’d prefer a simple setup that’s easy for a beginner to use.",
        enforcement: "soft",
      },
    ],
  },
];

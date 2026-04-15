import { anthropic } from "@ai-sdk/anthropic";
import { hasToolCall, stepCountIs, ToolLoopAgent } from "ai";
import { createCalaTools } from "./cala-tools";
import { submitPortfolioTool } from "./submit-portfolio-tool";
import { SYSTEM_PROMPT } from "./system-prompt";

// The trading agent. Composes Anthropic Sonnet 4.5 with Cala's three-endpoint
// research loop plus our submit_portfolio validator tool. Two stop conditions:
// either the agent commits via submit_portfolio, or we run out of steps.
//
// Step budget note: 50 stocks x 3 tool calls = 150 worst case. We start at 80
// because the system prompt encourages batched introspection and lighter
// research for obvious blue chips. Raise if we see the budget blow through in
// practice.

export function createTradingAgent() {
  const calaTools = createCalaTools();

  return new ToolLoopAgent({
    model: anthropic("claude-sonnet-4-5"),
    instructions: SYSTEM_PROMPT,
    tools: {
      ...calaTools,
      submit_portfolio: submitPortfolioTool,
    },
    stopWhen: [stepCountIs(80), hasToolCall("submit_portfolio")],
  });
}

export type TradingAgent = ReturnType<typeof createTradingAgent>;

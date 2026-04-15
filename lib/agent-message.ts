import type { InferAgentUIMessage } from "ai";
import type { TradingAgent } from "./agent";

// The UI-side message type for the trading agent. Each `tool-<name>` part is
// typed against the agent's tool set, so the client renders
// `tool-entity_search`, `tool-entity_introspection`, `tool-retrieve_entity`,
// and `tool-finalize_portfolio` with full type safety on their `input` / `output`
// fields.
export type TradingMessage = InferAgentUIMessage<TradingAgent>;

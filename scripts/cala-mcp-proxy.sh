#!/bin/sh
set -eu

if [ -z "${CALA_API_KEY:-}" ]; then
  echo "CALA_API_KEY is required for Cala MCP proxy" >&2
  exit 1
fi

exec npx -y mcp-remote https://api.cala.ai/mcp/ --header "X-API-KEY: ${CALA_API_KEY}"

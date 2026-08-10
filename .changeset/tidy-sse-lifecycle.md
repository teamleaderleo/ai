---
'@ai-sdk/mcp': patch
---

Keep the optional inbound HTTP MCP SSE channel single-flight across open, EOF, and reconnect transitions, and release its reader lock when the channel ends.

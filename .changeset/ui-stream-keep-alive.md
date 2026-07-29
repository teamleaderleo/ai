---
'ai': patch
---

Add an optional `keepAliveMs` interval to UI message stream responses. When enabled, the client response branch emits an immediate SSE comment to flush headers and periodic idle comments without adding synthetic frames to `consumeSseStream` consumers.

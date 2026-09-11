---
name: Groq vision reasoning
description: Groq multimodal reasoning-output behavior observed while generating image descriptions.
---

For Groq's Qwen multimodal models, prefer disabling reasoning when the application needs only a short user-facing image description. In this project, hidden reasoning produced an empty assistant content field, while raw reasoning leaked internal analysis and exhausted the output limit.

**Why:** A valid image request succeeded visually but failed at the application layer because there was no final content to cache. Disabling reasoning returned a concise final answer reliably.

**How to apply:** For short image-caption requests, request no reasoning and validate that assistant content is a non-empty string before caching it. Use a new cache namespace whenever the vision model or output behavior changes.
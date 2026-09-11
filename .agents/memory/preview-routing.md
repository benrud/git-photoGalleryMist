---
name: Preview routing
description: Distinguishing internal preview checks from public port routing failures.
---
Local screenshots do not verify the URL selected in the user's Preview address bar.

**Why:** A preview selected with an explicit :5000 returned a public proxy 502 while the portless HTTPS domain returned 200 with local port 5000 mapped to external port 80. Missing images were unrelated to that connection failure.

**How to apply:** Compare the exact browser URL with the portless public URL before changing application code or claiming a preview fix. Keep internal listening ports distinct from external URL ports.
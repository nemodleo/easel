---
description: Open the Easel design canvas for this project (starts it in the background unless one is already running)
argument-hint: "[design folder]"
allowed-tools: Bash(npx -y easel-canvas@latest up) Bash(npx -y easel-canvas@latest up *) Bash(npx -y easel-canvas@latest status *)
---

Open the Easel canvas for this project.

1. Run from the project root, adding `--dir $ARGUMENTS` only if a folder was given:

   ```bash
   npx -y easel-canvas@latest up
   ```

   It exits right away. If a canvas is already running for this folder it prints that one and starts nothing; otherwise it starts one in the background, opens it in the browser and prints its URL.

2. If it says `No design folder at …`: tell the person this project has no design folder yet and ask whether to create `docs/design` with a starter screen. Only after a yes, run `npx -y easel-canvas@latest up --init` (with the same `--dir` if one was given).

3. Reply with the URL in one line, and which design folder it shows. If the `easel` MCP tools are available, call `list_boards` and add one line on how many boards there are. If they are not, say that `npx easel-canvas connect` (then restarting the agent) gives the agent the canvas tools.

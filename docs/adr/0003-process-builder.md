# 3. Offices draw their own processes

Status: accepted

Each office configures its own process on a drag-and-drop canvas instead of us hard-coding one workflow. The process is data (steps and connections), validated, test-run on a sample case and published as a numbered version, and a small engine runs it for every new application. AI steps (reading documents, drafting mails) are building blocks, but decisions stay with a `human_task` step. Connectors to office systems are placeholders that share one interface, so real systems can be plugged in later. Access to the builder is restricted to employees an administrator unlocks. We use React Flow for the canvas.

Consequences: the engine only supports acyclic processes without parallel branches and without timers (reminders are only recorded). Processes are not yet versioned per case, and a change goes live without a second approval. Both are listed in the architecture notes.

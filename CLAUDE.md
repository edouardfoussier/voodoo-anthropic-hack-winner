# CLAUDE.md

Claude Code reads this file at session start. The full team agent harness lives in [`AGENTS.md`](./AGENTS.md) — read it now before doing anything.

## Why this file exists

`AGENTS.md` is the canonical, tool-agnostic harness for HookLens (Voodoo Hack 2026, Track 3). Every coding agent on the team — Claude Code, Codex CLI, Cursor, Continue — must follow it. This `CLAUDE.md` is here so Claude Code surfaces the same content automatically when you open the repo.

## Claude-specific addendum

A few things tailored to Claude Code that don't belong in `AGENTS.md`:

### Subagents

When Edouard launches a subagent for a parallel task (typical examples: Streamlit UI scaffolding, notebook smoke tests, brief PDF generator), the subagent must:

1. Read this file and `AGENTS.md` first
2. Stay strictly inside its assigned workstream paths (see §4 of `AGENTS.md`)
3. Never modify `app/models.py`
4. Commit to a topic branch named `<owner>-<topic>` (e.g. `edouard-ui`, `edouard-deconstruct`)
5. Stop and ask before any `uv add <pkg>` of a dependency not already in `pyproject.toml`

### MCP usage

Two MCPs matter for this project:

- **Scenario MCP** — Partner 2 owns this. The connector is installed via the Anthropic-published Scenario MCP server. Only `app/creative/scenario.py` should call it. Do not call Scenario from any other module.
- **GitHub MCP** (if installed) — read-only is fine for context. Never use it to merge PRs or push to `main` from within an agent session.

### Slash commands and skills

If a teammate creates a Claude skill under `.claude/skills/` for a recurring workflow (e.g. "generate a creative brief from an archetype"), invoke it by name rather than re-prompting from scratch. Skills live alongside the codebase and survive across conversations.

### Context window hygiene

When `/context` shows the conversation past 60% utilization on a single task, **start a new conversation** and front-load only the files you need. Per Voodoo's prototyping guide, this beats pushing through the dumb zone every time.

### Models

- **Spec or Plan conversation**: Opus 4.7, max thinking
- **Build conversation**: Sonnet 4.6, max thinking
- **Quick edits, formatting, glue code**: Sonnet 4.6, default thinking

We have ~$40 of Anthropic credits per team. Reserve Opus for spec, plan, and the final brief-generation step inside the pipeline.

---

For everything else (data contract, workstream boundaries, tech stack, conventions, quality bar, demo strategy, forbidden actions), defer to **`AGENTS.md`**.

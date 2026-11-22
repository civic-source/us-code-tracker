# Issue tracker: GitHub

Issues and specs for `civic-source` live as GitHub Issues in their respective repositories (primarily `civic-source/us-code-tracker`). Use the `gh` CLI (`-R civic-source/<repo>` when running from the workspace root) for all operations.

## Conventions

- **Create an issue**: `gh issue create -R civic-source/us-code-tracker --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> -R civic-source/us-code-tracker --json number,title,body,labels,comments`.
- **List issues**: `gh issue list -R civic-source/us-code-tracker --state open --json number,title,body,labels,comments` with appropriate `--label` and `--state` filters.
- **Sub-issues**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>`. Without sub-issues, put `Part of civic-source/us-code-tracker#<parent>` at the top of the child body.
- **Blocking**: Use GitHub's native issue dependencies (`gh issue create --blocked-by <n>` or `gh issue edit <child> --add-blocked-by <blocker>`), or fall back to `Blocked by: civic-source/us-code-tracker#<n>` at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Comment / Close**: Post explanations with `gh issue comment <number> --body "..."`, then `gh issue close <number>`.
- **Filing Gate (GSA-TTS §9.3 & §15.5)**: File out-of-scope defects or deferred/blocked work immediately if and only if they are (1) Real, (2) In-scope for `civic-source`, (3) Not already tracked, and (4) Actionable. Never file security vulnerabilities as public issues (report privately per `SECURITY.md`).

// AI-generated with Claude Code, 2026-11-15, reviewed by Hyun Park
// Fake agent that fails the way Codex does at its usage limit: the error on stderr, exit code 1, no file touched.
process.stderr.write('error: usage_limit_reached\n"You\'ve hit your usage limit. Try again at Nov 26th, 2026 9:14 AM."\n');
process.exit(1);

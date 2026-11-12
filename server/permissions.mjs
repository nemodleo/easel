// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Permission requests from an in-app Claude Code run (--permission-prompt-tool): what the card shows, the "Always allow" rule,
// and the pending requests per run that the MCP permission tool waits on. Always-allow rules live in memory only (never in the project).
import { realpathSync } from "node:fs";
import path from "node:path";

import { toPosix } from "./fsutil.mjs";

/** Shell operators and substitutions: a command with any of these never gets an "Always allow" rule */
export const SHELL_OPERATORS = /[;&|<>`\n\r]|\$\(/;

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Resolved path (/var → /private/var), also for a file that does not exist yet: its nearest existing parent */
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    const up = path.dirname(p);
    return up === p ? p : path.join(real(up), path.basename(p));
  }
};
const inside = (p, dir) => {
  const rel = path.relative(dir, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
/** Path as shown on the card: relative to the project when inside it (agents report resolved paths), else as requested */
const shownPath = (asked, abs, root) => (inside(abs, root) ? toPosix(path.relative(root, abs)) || "." : asked);

/** Programs that run whatever follows them, and flags that take code to run: two words of these would cover any command */
const WRAPPERS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "env", "xargs", "sudo", "doas", "eval", "exec", "command", "nohup", "time", "nice", "timeout", "watch", "ssh"]);
const CODE_FLAG = /^-{1,2}(c|e|p|eval|exec|command)$/;

/**
 * "Always allow" rule for a request: the tool name, or "Bash <first two words>"; null when none may be offered.
 * Never for file tools: the run already edits inside the project without asking (acceptEdits), so a request for one is a file
 * outside it or a protected one, and a rule by tool name would open every such path.
 */
export function permissionRule(tool, input) {
  const name = String(tool ?? "");
  if (!name || FILE_TOOLS.has(name)) return null;
  if (name !== "Bash") return { rule: name, label: name };
  const cmd = String(input?.command ?? "").trim();
  if (!cmd || SHELL_OPERATORS.test(cmd)) return null;
  const [first, second] = cmd.split(/\s+/);
  if (WRAPPERS.has(first.split("/").pop()) || (second && CODE_FLAG.test(second))) return null;
  const words = [first, second].filter(Boolean).join(" ");
  return { rule: `Bash ${words}`, label: words };
}

/** Whether a request falls under a remembered rule (Bash rules match the first two words of an operator-free command) */
export const ruleMatches = (rules, tool, input) => {
  const r = permissionRule(tool, input);
  return !!r && rules.has(r.rule);
};

/**
 * What the card shows, taken from the request as is: what (command | edit | fetch | tool), subject (the exact command,
 * file path, URL, or the input as JSON), the working folder, and whether a file path is outside the design folder
 */
export function describePermission(tool, input, { root, dir }) {
  const name = String(tool ?? "");
  const inp = input && typeof input === "object" ? input : {};
  const where = root;
  if (name === "Bash") return { what: "command", tool: name, subject: String(inp.command ?? ""), where };
  if (FILE_TOOLS.has(name) && (inp.file_path || inp.notebook_path)) {
    const asked = path.resolve(root, String(inp.file_path ?? inp.notebook_path));
    const abs = real(asked);
    return { what: "edit", tool: name, subject: shownPath(asked, abs, real(root)), where, outside: !inside(abs, real(dir)) };
  }
  if (name === "WebFetch" && inp.url) return { what: "fetch", tool: name, subject: String(inp.url), where };
  return { what: "tool", tool: name, subject: JSON.stringify(inp, null, 1), where };
}

/**
 * Pending requests: request(run, tool, input) → { id, decided? }; wait(id, ms) resolves to the decision or null on timeout;
 * answer(id, decision) settles it. Decisions are allow-once | always | deny. Rules are remembered for this server process only.
 */
export function createPermissions() {
  const rules = new Set();
  const pending = new Map(); // id → { id, run, tool, input, decision, waiters: [] }
  let n = 0;

  const settle = (p, decision) => {
    if (p.decision) return false;
    p.decision = decision;
    for (const w of p.waiters.splice(0)) w(decision);
    setTimeout(() => pending.delete(p.id), 60000).unref?.(); // a late poll still gets the answer
    return true;
  };

  return {
    rules,
    pending,
    /** New request; when a remembered rule covers it the decision is already "always" */
    request(run, tool, input) {
      const id = `p${Date.now().toString(36)}${(n++).toString(36)}`;
      const p = { id, run, tool, input, decision: null, waiters: [] };
      pending.set(id, p);
      if (ruleMatches(rules, tool, input)) settle(p, "always");
      return p;
    },
    /** Resolves to the decision, or null when none came within ms (the MCP tool asks again) */
    wait(id, ms = 25000) {
      const p = pending.get(id);
      if (!p) return Promise.resolve("deny");
      if (p.decision) return Promise.resolve(p.decision);
      return new Promise((resolve) => {
        const t = setTimeout(() => {
          p.waiters.splice(p.waiters.indexOf(done), 1);
          resolve(null);
        }, ms);
        const done = (d) => {
          clearTimeout(t);
          resolve(d);
        };
        p.waiters.push(done);
      });
    },
    /** Settles an open request; "always" also remembers its rule. false when unknown or already answered */
    answer(id, decision) {
      const p = pending.get(id);
      if (!p || !["once", "always", "deny"].includes(decision)) return null;
      if (decision === "always") {
        const r = permissionRule(p.tool, p.input);
        if (!r) return null;
        rules.add(r.rule);
      }
      return settle(p, decision) ? p : null;
    },
    /** Denies every open request (of one run, or all): cancel, run end, server close */
    denyAll(run) {
      const out = [];
      for (const p of pending.values()) if (!p.decision && (!run || p.run === run) && settle(p, "deny")) out.push(p);
      return out;
    },
  };
}

/** The answer Claude Code expects back from the permission prompt tool */
export const toolAnswer = (decision, input) => (decision === "once" || decision === "always" ? { behavior: "allow", updatedInput: input ?? {} } : { behavior: "deny", message: "The user denied this in Easel" });

// AI-generated with Claude Code, 2026-11-11, reviewed by Hyun Park
// Custom agent commands ("Custom command…" in the AI tab): stored per user in <EASEL_HOME or ~/.easel>/agents.json, never in the
// project (a cloned repository must not be able to ship a command). Run without a shell: {prompt} is substituted inside one argument.
import fs from "node:fs/promises";
import path from "node:path";

import { writeAtomic } from "./fsutil.mjs";
import { easelHome } from "./registry.mjs";

const file = (home) => path.join(home, "agents.json");
const MAX = 20;

/** Splits a command line into arguments like a POSIX shell would quote them: '…', "…" and \ escapes; no expansion of any kind */
export function splitCommand(line) {
  const out = [];
  let cur = "";
  let has = false;
  let q = null;
  const s = String(line ?? "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q === "'") {
      if (ch === "'") q = null;
      else cur += ch;
    } else if (q === '"') {
      if (ch === '"') q = null;
      else if (ch === "\\" && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) cur += s[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      q = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (q) throw new Error("Unclosed quote in the command");
  if (has || cur) out.push(cur);
  return out;
}

/** Name and command checked before saving: a name, a program, and {prompt} in an argument after it */
export function checkCustom({ name, command }) {
  const n = String(name ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!n || n.length > 40) return { error: "Give the command a name (up to 40 characters)" };
  const c = String(command ?? "").trim();
  if (!c || c.length > 1000 || /[\r\n]/.test(c)) return { error: "Enter the command on one line" };
  let args;
  try {
    args = splitCommand(c);
  } catch (e) {
    return { error: e.message };
  }
  if (!args.length || args[0].includes("{prompt}")) return { error: "The command must start with a program name" };
  if (!args.slice(1).some((a) => a.includes("{prompt}"))) return { error: "Put {prompt} where your request should go" };
  return { name: n, command: c };
}

/** argv for a run: {prompt} replaced inside the argument it appears in, so the request is always exactly one argument's worth */
export function customArgv(command, prompt) {
  const [cmd, ...rest] = splitCommand(command);
  return { cmd, args: rest.map((a) => a.split("{prompt}").join(prompt)) };
}

export async function readCustom(home = easelHome()) {
  try {
    const d = JSON.parse(await fs.readFile(file(home), "utf8"));
    return (Array.isArray(d.custom) ? d.custom : []).filter((c) => c && /^c[0-9a-z]+$/.test(c.id) && !checkCustom(c).error);
  } catch {
    return [];
  }
}

async function writeCustom(list, home) {
  await fs.mkdir(home, { recursive: true });
  await writeAtomic(file(home), JSON.stringify({ custom: list }, null, 1) + "\n");
}

/** Adds a command; { agent } or { error } */
export async function addCustom(body, home = easelHome()) {
  const c = checkCustom(body);
  if (c.error) return c;
  const list = await readCustom(home);
  if (list.length >= MAX) return { error: `Up to ${MAX} custom commands` };
  const agent = { id: `c${Date.now().toString(36)}`, name: c.name, command: c.command };
  while (list.some((x) => x.id === agent.id)) agent.id = `c${(parseInt(agent.id.slice(1), 36) + 1).toString(36)}`;
  await writeCustom([...list, agent], home);
  return { agent };
}

export async function removeCustom(id, home = easelHome()) {
  const list = await readCustom(home);
  await writeCustom(
    list.filter((c) => c.id !== id),
    home,
  );
}

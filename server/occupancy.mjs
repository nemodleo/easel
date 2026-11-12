// AI-generated with Claude Code, 2026-11-12, reviewed by Hyun Park
// Who is on which board right now, kept in memory only (nothing is written to the project). An agent holds a board from its first
// write: an in-app chat run until the run ends, an MCP client until QUIET_MS pass without another write or until it disconnects;
// then it shows as done for DONE_MS. A person holds a board while a browser has an element selected on it (closing the tab releases it).

/** An MCP client that has not written for this long is no longer editing */
export const QUIET_MS = 45000;
/** How long "Claude Code · done 13:52" stays above a board */
export const DONE_MS = 30 * 60 * 1000;

/**
 * onChange(snapshot) runs after every change someone can see (a writer starts or finishes, a person enters or leaves); a write
 * that only keeps a holder busy does not call it
 */
export function createOccupancy({ quietMs = QUIET_MS, doneMs = DONE_MS, onChange = () => {} } = {}) {
  /** file → { base, holders: Map<key, holder> } — holder: { key, kind, by | person, client, runs, clients, conns, since, quietUntil, doneAt, timer } */
  const files = new Map();
  const conns = new Map(); // WebSocket id → { file, key }
  const changed = () => onChange(snapshot());
  const timer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  };

  const rec = (file) => {
    let r = files.get(file);
    if (!r) files.set(file, (r = { base: null, holders: new Map() }));
    return r;
  };
  const active = (h) => h.kind === "person" || (!h.doneAt && (h.runs.size > 0 || h.quietUntil > Date.now()));
  const agentsOn = (file) => [...(files.get(file)?.holders.values() ?? [])].filter((h) => h.kind === "agent" && active(h));
  const drop = (file, key) => {
    const r = files.get(file);
    const h = r?.holders.get(key);
    if (!h) return;
    clearTimeout(h.timer);
    r.holders.delete(key);
    if (!r.holders.size) files.delete(file);
  };

  /** Marks h done (or schedules the check for when its quiet time is over) */
  function settle(file, h) {
    clearTimeout(h.timer);
    if (h.runs.size || h.doneAt) return;
    const left = h.quietUntil - Date.now();
    if (left > 0) return void (h.timer = timer(() => settle(file, h), left + 5));
    h.doneAt = Date.now();
    h.timer = timer(() => {
      drop(file, h.key);
      changed();
    }, doneMs);
    changed();
  }

  /**
   * An agent wrote (or is about to write) a board. run: the in-app run it belongs to (held until runEnded); client: the MCP client
   * (held until it goes quiet or disconnects); before: the board's content before this write (kept as the fork base when it starts
   * the board's first hold)
   */
  function agentWrite(file, by, { run, client, before } = {}) {
    const r = rec(file);
    if (!agentsOn(file).length) r.base = before ?? r.base;
    const key = `a:${by}`;
    let h = r.holders.get(key);
    const fresh = !h || !active(h);
    if (!h) r.holders.set(key, (h = { key, kind: "agent", by, runs: new Set(), clients: new Set(), since: Date.now(), quietUntil: 0, doneAt: null, timer: null }));
    if (fresh) {
      clearTimeout(h.timer); // the timer that would drop the done label
      h.since = Date.now();
      h.doneAt = null;
    }
    if (run) h.runs.add(run);
    else {
      if (client) h.clients.add(client);
      h.quietUntil = Date.now() + quietMs;
      clearTimeout(h.timer);
      h.timer = timer(() => settle(file, h), quietMs + 5);
    }
    if (fresh) changed();
    return h;
  }

  /** A write nobody claimed landed on a board an agent holds (its own file tools after claim_board): that agent stays busy */
  function touch(file) {
    for (const h of agentsOn(file))
      if (!h.runs.size) {
        h.quietUntil = Date.now() + quietMs;
        clearTimeout(h.timer);
        h.timer = timer(() => settle(file, h), quietMs + 5);
      }
  }

  function runEnded(run) {
    for (const [file, r] of [...files])
      for (const h of [...r.holders.values()])
        if (h.runs.delete(run) && !h.runs.size) settle(file, h); // done now, unless the same agent also wrote over MCP within its quiet time
  }

  /** An MCP client disconnected: boards it alone kept busy are done now */
  function clientGone(client) {
    for (const [file, r] of [...files])
      for (const h of [...r.holders.values()])
        if (h.clients.delete(client) && !h.clients.size && !h.runs.size && !h.doneAt) {
          h.quietUntil = 0;
          settle(file, h);
        }
  }

  /** A browser (WebSocket conn) selected an element on file, or let go (file null); who: { client, person } */
  function personEdit(conn, file, who = {}) {
    const cur = conns.get(conn);
    if (cur?.file === file) return;
    let any = false;
    if (cur) {
      const h = files.get(cur.file)?.holders.get(cur.key);
      h?.conns.delete(conn);
      if (h && !h.conns.size) drop(cur.file, cur.key);
      conns.delete(conn);
      any = true;
    }
    if (file) {
      const key = `p:${who.client || conn}`;
      const r = rec(file);
      let h = r.holders.get(key);
      if (!h) r.holders.set(key, (h = { key, kind: "person", person: who.person || undefined, client: who.client || undefined, conns: new Set(), since: Date.now() }));
      h.conns.add(conn);
      conns.set(conn, { file, key });
      any = true;
    }
    if (any) changed();
  }

  /** The board's file is gone (trashed, deleted): nobody is on it any more */
  function forget(file) {
    const r = files.get(file);
    if (!r) return;
    for (const h of r.holders.values()) clearTimeout(h.timer);
    for (const [c, v] of [...conns]) if (v.file === file) conns.delete(c);
    files.delete(file);
    changed();
  }

  /** What browsers draw: per board, its holders (editing or done), oldest first */
  function snapshot() {
    const out = {};
    for (const [file, r] of files) {
      const list = [...r.holders.values()]
        .sort((a, b) => a.since - b.since)
        .map((h) => ({
          key: h.key,
          kind: h.kind,
          ...(h.by ? { by: h.by } : {}),
          ...(h.person ? { person: h.person } : {}),
          ...(h.client ? { client: h.client } : {}),
          state: active(h) ? "editing" : "done",
          since: h.since,
          ...(h.doneAt && !active(h) ? { doneAt: h.doneAt } : {}),
        }));
      if (list.length) out[file] = list;
    }
    return out;
  }

  return {
    agentWrite,
    touch,
    runEnded,
    clientGone,
    personEdit,
    forget,
    snapshot,
    /** Agents editing file now (people never count: they are never forked) */
    agentsOn: (file) => agentsOn(file).map((h) => ({ by: h.by, since: h.since })),
    /** The board as it was when its current writer started, if known */
    base: (file) => (agentsOn(file).length ? (files.get(file)?.base ?? null) : null),
    close() {
      for (const r of files.values()) for (const h of r.holders.values()) clearTimeout(h.timer);
      files.clear();
      conns.clear();
    },
  };
}

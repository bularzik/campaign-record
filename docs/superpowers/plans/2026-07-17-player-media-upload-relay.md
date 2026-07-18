# Player Media Upload via GM Relay + Mount Race Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players without Foundry's `FILES_UPLOAD` permission can add media (docx-import images and hub drag-drop) whenever a GM is online — file bytes relay over the module socket and the active GM performs a validated upload — and the record pane's `mount()` race (which destroys ProseMirror editors during import render storms) is eliminated.

**Architecture:** A chunked `UPLOAD_MEDIA` request/response protocol on the existing raw `module.campaign-record` socket (same pattern as `auto-capture.mjs`'s `DROP_MEDIA_ACTION`), with pure validation/assembly helpers in `scripts/logic/media-relay.mjs`. One shared entry point `uploadHubMediaAsUser` routes direct/relay/no-GM. `RecordPane.mount` serializes through a pure promise queue with staleness tokens.

**Tech Stack:** Foundry VTT v13 module, plain ESM `.mjs` (no TypeScript, no new deps), vitest for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-07-17-player-media-upload-relay-design.md`

## Global Constraints

- Plain ESM JavaScript (`.mjs`); follow existing file style (JSDoc comments stating constraints, not narration).
- `scripts/logic/*` must stay free of Foundry globals at module scope AND call time (unit-tested in Node).
- Relay limits (exact values): max decoded file size **10 MB** (`10 * 1024 * 1024`), base64 chunk size **256 KB chars** (`256 * 1024`), player-side timeout **30 s**, GM-side stale-buffer eviction **60 s**. Images only: MIME `image/<subtype>` where subtype ∈ `IMAGE_SUBTYPE_EXT` (`scripts/logic/import-images.mjs`).
- Every user-facing string lives in `lang/en.json` under `CAMPAIGNRECORD.*` (an `i18n-coverage` test enforces this).
- Unit tests: `npm test` (vitest, from repo root). All existing tests must stay green.
- E2E: **read and follow the `campaign-record:foundry-e2e` skill contract before any e2e run or server start.** Command: `npm run test:e2e -- tests/e2e/30-player-media-relay.spec.mjs`.
- Module sockets have no authenticated sender (see `scripts/presenter/socket.mjs:15-21`): the GM handler must validate every request — group must exist and be a campaign-record group, MIME image-only, size cap — and must never use a caller-supplied path.
- Conventional commit per task.

---

### Task 1: Pure relay protocol helpers

**Files:**
- Create: `scripts/logic/media-relay.mjs`
- Test: `tests/media-relay.test.js`

**Interfaces:**
- Consumes: `IMAGE_SUBTYPE_EXT` from `scripts/logic/import-images.mjs` (existing).
- Produces (used by Tasks 2 and 5):
  - `MAX_RELAY_FILE_BYTES: number`, `RELAY_CHUNK_SIZE: number`, `RELAY_BUFFER_STALE_MS: number`
  - `base64ByteLength(base64: string): number`
  - `chunkBase64(base64: string): string[]` — never empty (a zero-length body yields `[""]`)
  - `isRelayableImageType(mime: string): boolean`
  - `chunkProblem(payload): string|null` — null when the chunk is well-formed
  - `createRelayAssembler({maxBytes?, staleMs?}): { accept(payload, now: number): {status:"invalid",reason:string} | {status:"pending"} | {status:"complete", request:{requestId,groupId,name,type,base64}}, size(): number }`

- [ ] **Step 1: Write the failing test**

Create `tests/media-relay.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  MAX_RELAY_FILE_BYTES, RELAY_CHUNK_SIZE,
  base64ByteLength, chunkBase64, isRelayableImageType, chunkProblem, createRelayAssembler
} from "../scripts/logic/media-relay.mjs";

describe("base64ByteLength", () => {
  it("computes decoded size accounting for padding", () => {
    expect(base64ByteLength(btoa("a"))).toBe(1);      // "YQ=="
    expect(base64ByteLength(btoa("ab"))).toBe(2);     // "YWI="
    expect(base64ByteLength(btoa("abc"))).toBe(3);    // "YWJj"
    expect(base64ByteLength("")).toBe(0);
    expect(base64ByteLength(null)).toBe(0);
  });
});

describe("chunkBase64", () => {
  it("splits into RELAY_CHUNK_SIZE pieces preserving order", () => {
    const body = "x".repeat(RELAY_CHUNK_SIZE + 5);
    const chunks = chunkBase64(body);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(RELAY_CHUNK_SIZE);
    expect(chunks[1]).toBe("xxxxx");
    expect(chunks.join("")).toBe(body);
  });
  it("yields a single empty chunk for an empty body", () => {
    expect(chunkBase64("")).toEqual([""]);
  });
});

describe("isRelayableImageType", () => {
  it("accepts renderable image MIME types case-insensitively", () => {
    expect(isRelayableImageType("image/png")).toBe(true);
    expect(isRelayableImageType("image/JPEG")).toBe(true);
    expect(isRelayableImageType("image/svg+xml")).toBe(true);
  });
  it("rejects videos, non-renderable images, and junk", () => {
    expect(isRelayableImageType("video/webm")).toBe(false);
    expect(isRelayableImageType("image/x-emf")).toBe(false);
    expect(isRelayableImageType("application/pdf")).toBe(false);
    expect(isRelayableImageType(null)).toBe(false);
  });
});

const chunk = (over = {}) => ({
  requestId: "req1", groupId: "g1", name: "map.png", type: "image/png",
  seq: 0, total: 1, data: btoa("abc"), ...over
});

describe("chunkProblem", () => {
  it("passes a well-formed chunk", () => {
    expect(chunkProblem(chunk())).toBeNull();
  });
  it("names the defect for malformed chunks", () => {
    expect(chunkProblem(chunk({ requestId: "" }))).toBe("bad-request-id");
    expect(chunkProblem(chunk({ groupId: 7 }))).toBe("bad-group");
    expect(chunkProblem(chunk({ name: "" }))).toBe("bad-name");
    expect(chunkProblem(chunk({ type: "video/webm" }))).toBe("bad-type");
    expect(chunkProblem(chunk({ seq: -1 }))).toBe("bad-seq");
    expect(chunkProblem(chunk({ seq: 1, total: 1 }))).toBe("bad-seq");
    expect(chunkProblem(chunk({ total: 0 }))).toBe("bad-seq");
    expect(chunkProblem(chunk({ data: 42 }))).toBe("bad-data");
    expect(chunkProblem(null)).toBe("bad-request-id");
  });
});

describe("createRelayAssembler", () => {
  it("completes a single-chunk request", () => {
    const a = createRelayAssembler();
    const out = a.accept(chunk(), 1000);
    expect(out.status).toBe("complete");
    expect(out.request).toEqual({
      requestId: "req1", groupId: "g1", name: "map.png", type: "image/png", base64: btoa("abc")
    });
    expect(a.size()).toBe(0);
  });
  it("assembles multi-chunk requests in seq order regardless of arrival order", () => {
    const a = createRelayAssembler();
    expect(a.accept(chunk({ seq: 1, total: 2, data: "BBBB" }), 1000).status).toBe("pending");
    const out = a.accept(chunk({ seq: 0, total: 2, data: "AAAA" }), 1001);
    expect(out.status).toBe("complete");
    expect(out.request.base64).toBe("AAAABBBB");
  });
  it("ignores duplicate seqs without double-counting", () => {
    const a = createRelayAssembler();
    a.accept(chunk({ seq: 0, total: 2, data: "AAAA" }), 1000);
    expect(a.accept(chunk({ seq: 0, total: 2, data: "AAAA" }), 1001).status).toBe("pending");
    expect(a.accept(chunk({ seq: 1, total: 2, data: "BBBB" }), 1002).status).toBe("complete");
  });
  it("rejects over-size accumulations and drops the buffer", () => {
    const a = createRelayAssembler({ maxBytes: 3 });
    const out = a.accept(chunk({ data: btoa("abcd") }), 1000); // 4 bytes > 3
    expect(out).toEqual({ status: "invalid", reason: "too-large" });
    expect(a.size()).toBe(0);
  });
  it("rejects a chunk whose total disagrees with the open buffer", () => {
    const a = createRelayAssembler();
    a.accept(chunk({ seq: 0, total: 3, data: "A" }), 1000);
    expect(a.accept(chunk({ seq: 1, total: 2, data: "B" }), 1001))
      .toEqual({ status: "invalid", reason: "bad-seq" });
    expect(a.size()).toBe(0);
  });
  it("evicts stale buffers", () => {
    const a = createRelayAssembler({ staleMs: 100 });
    a.accept(chunk({ seq: 0, total: 2, data: "A" }), 1000);
    expect(a.size()).toBe(1);
    a.accept(chunk({ requestId: "req2", seq: 0, total: 2, data: "A" }), 2000);
    expect(a.size()).toBe(1); // req1 evicted, req2 open
  });
  it("respects MAX_RELAY_FILE_BYTES as the default cap", () => {
    expect(MAX_RELAY_FILE_BYTES).toBe(10 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/media-relay.test.js`
Expected: FAIL — `Cannot find module '../scripts/logic/media-relay.mjs'`

- [ ] **Step 3: Write the implementation**

Create `scripts/logic/media-relay.mjs`:

```js
import { IMAGE_SUBTYPE_EXT } from "./import-images.mjs";

/**
 * Pure protocol helpers for relaying a player's media upload to the active
 * GM over the module socket. No Foundry globals — unit-tested with vitest.
 * The socket transport caps message size, so file bytes travel as
 * sequence-numbered base64 chunks reassembled GM-side.
 */

export const MAX_RELAY_FILE_BYTES = 10 * 1024 * 1024;
export const RELAY_CHUNK_SIZE = 256 * 1024; // base64 chars per socket message
export const RELAY_BUFFER_STALE_MS = 60 * 1000;

/** Decoded byte length of a base64 string. */
export function base64ByteLength(base64) {
  if (typeof base64 !== "string" || !base64.length) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

/** Split a base64 body into RELAY_CHUNK_SIZE-char chunks; never empty. */
export function chunkBase64(base64) {
  const chunks = [];
  for (let i = 0; i < base64.length; i += RELAY_CHUNK_SIZE) {
    chunks.push(base64.slice(i, i + RELAY_CHUNK_SIZE));
  }
  return chunks.length ? chunks : [""];
}

/** Only image types Foundry can render may travel over the relay. */
export function isRelayableImageType(mime) {
  const m = /^image\/([a-z0-9.+-]+)$/i.exec(mime ?? "");
  return !!m && m[1].toLowerCase() in IMAGE_SUBTYPE_EXT;
}

/** Shape-check one relayed chunk. Null when valid, else a reason slug. */
export function chunkProblem(p) {
  if (typeof p?.requestId !== "string" || !p.requestId) return "bad-request-id";
  if (typeof p.groupId !== "string" || !p.groupId) return "bad-group";
  if (typeof p.name !== "string" || !p.name) return "bad-name";
  if (!isRelayableImageType(p.type)) return "bad-type";
  if (!Number.isInteger(p.seq) || p.seq < 0) return "bad-seq";
  if (!Number.isInteger(p.total) || p.total < 1 || p.seq >= p.total) return "bad-seq";
  if (typeof p.data !== "string") return "bad-data";
  return null;
}

/**
 * Chunk reassembly for the GM side. `now` is injected so tests control time;
 * buffers untouched for staleMs are evicted on the next accept().
 */
export function createRelayAssembler({ maxBytes = MAX_RELAY_FILE_BYTES, staleMs = RELAY_BUFFER_STALE_MS } = {}) {
  const buffers = new Map(); // requestId -> {groupId,name,type,total,parts,received,bytes,touched}
  return {
    accept(payload, now) {
      for (const [id, buf] of buffers) if (now - buf.touched > staleMs) buffers.delete(id);
      const reason = chunkProblem(payload);
      if (reason) return { status: "invalid", reason };
      let buf = buffers.get(payload.requestId);
      if (!buf) {
        buf = {
          groupId: payload.groupId, name: payload.name, type: payload.type,
          total: payload.total, parts: new Array(payload.total).fill(null),
          received: 0, bytes: 0, touched: now
        };
        buffers.set(payload.requestId, buf);
      }
      buf.touched = now;
      if (payload.total !== buf.total) {
        buffers.delete(payload.requestId);
        return { status: "invalid", reason: "bad-seq" };
      }
      if (buf.parts[payload.seq] === null) {
        buf.parts[payload.seq] = payload.data;
        buf.received += 1;
        buf.bytes += base64ByteLength(payload.data);
      }
      if (buf.bytes > maxBytes) {
        buffers.delete(payload.requestId);
        return { status: "invalid", reason: "too-large" };
      }
      if (buf.received < buf.total) return { status: "pending" };
      buffers.delete(payload.requestId);
      return {
        status: "complete",
        request: {
          requestId: payload.requestId, groupId: buf.groupId,
          name: buf.name, type: buf.type, base64: buf.parts.join("")
        }
      };
    },
    size() { return buffers.size; }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/media-relay.test.js`
Expected: PASS (all describes green). Then `npm test` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/media-relay.mjs tests/media-relay.test.js
git commit -m "feat(relay): pure chunked upload-relay protocol helpers"
```

---

### Task 2: Runtime socket relay + registration

**Files:**
- Create: `scripts/hooks/media-relay.mjs`
- Modify: `scripts/constants.mjs` (append after `DROP_MEDIA_ACTION`, line 70)
- Modify: `scripts/campaign-record.mjs` (import block + ready hook, lines 13 and 36)

**Interfaces:**
- Consumes: Task 1 helpers; `uploadHubMedia` from `scripts/apps/hub/media-upload.mjs` (existing); `isGroup` from `scripts/data/groups.mjs` (existing).
- Produces (used by Task 3):
  - `relayUploadMedia(group: JournalEntry, file: File): Promise<string>` — resolves the stored path
  - `RelayUploadError` (Error subclass)
  - `registerMediaRelaySocket(): void`
- Note: `media-upload.mjs` (Task 3) will import `relayUploadMedia` from this file while this file imports `uploadHubMedia` from it. That ESM cycle is safe — both imports are only dereferenced at call time — but do not add module-scope usage of either.

- [ ] **Step 1: Add socket action constants**

In `scripts/constants.mjs`, directly after the `DROP_MEDIA_ACTION` line:

```js
/** Socket action: one chunk of a player's media upload relayed to the active GM. */
export const UPLOAD_MEDIA_ACTION = "relay-upload-media";

/** Socket action: the GM's success/failure reply to a relayed media upload. */
export const UPLOAD_MEDIA_RESULT_ACTION = "relay-upload-media-result";
```

- [ ] **Step 2: Create the runtime module**

Create `scripts/hooks/media-relay.mjs`. Module scope must stay free of Foundry global access (only function bodies may touch `game`/`foundry`) so vitest can `vi.mock` around it and Task 3's tests can import `media-upload.mjs`.

```js
import { MODULE_ID, UPLOAD_MEDIA_ACTION, UPLOAD_MEDIA_RESULT_ACTION } from "../constants.mjs";
import { isGroup } from "../data/groups.mjs";
import {
  chunkBase64, createRelayAssembler, base64ByteLength, isRelayableImageType, MAX_RELAY_FILE_BYTES
} from "../logic/media-relay.mjs";
import { uploadHubMedia } from "../apps/hub/media-upload.mjs";

const SOCKET_NAME = `module.${MODULE_ID}`;
const RELAY_TIMEOUT_MS = 30_000;

const pending = new Map(); // requestId -> {resolve, reject, timer} on the requesting client
const assembler = createRelayAssembler();

export class RelayUploadError extends Error {}

/** Encode a File's bytes as base64 without exceeding the call stack. */
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const STRIDE = 0x8000;
  for (let i = 0; i < bytes.length; i += STRIDE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  }
  return btoa(binary);
}

/**
 * Ask the active GM to upload this image on our behalf; resolves with the
 * stored path. Images only, capped at MAX_RELAY_FILE_BYTES. The caller
 * ensures an active GM exists (uploadHubMediaAsUser).
 */
export async function relayUploadMedia(group, file) {
  if (!isRelayableImageType(file.type)) {
    throw new RelayUploadError(`campaign-record | not a relayable image: ${file.name}`);
  }
  const base64 = await fileToBase64(file);
  if (base64ByteLength(base64) > MAX_RELAY_FILE_BYTES) {
    throw new RelayUploadError(`campaign-record | too large to relay: ${file.name}`);
  }
  const requestId = foundry.utils.randomID();
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new RelayUploadError(`campaign-record | relay upload timed out for ${file.name}`));
    }, RELAY_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
  });
  chunkBase64(base64).forEach((data, seq, chunks) => {
    game.socket.emit(SOCKET_NAME, {
      action: UPLOAD_MEDIA_ACTION,
      requestId, groupId: group.id, name: file.name, type: file.type,
      seq, total: chunks.length, data
    });
  });
  return result;
}

/**
 * GM side: reassemble, validate, upload, reply. Requests are untrusted
 * (module sockets carry no authenticated sender): the target directory is
 * derived from a validated group id inside uploadHubMedia, never from the
 * payload, and only renderable image types under the size cap are accepted.
 */
async function handleUploadRequest(payload) {
  const outcome = assembler.accept(payload, Date.now());
  if (outcome.status === "pending") return;
  const requestId = outcome.status === "complete" ? outcome.request.requestId : payload?.requestId;
  const reply = (message) => {
    if (typeof requestId === "string" && requestId) {
      game.socket.emit(SOCKET_NAME, { action: UPLOAD_MEDIA_RESULT_ACTION, requestId, ...message });
    }
  };
  if (outcome.status === "invalid") return reply({ error: outcome.reason });
  const group = game.journal.get(outcome.request.groupId);
  if (!group || !isGroup(group)) return reply({ error: "unknown-group" });
  try {
    const bytes = Uint8Array.from(atob(outcome.request.base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], outcome.request.name, { type: outcome.request.type });
    const path = await uploadHubMedia(group, file);
    reply({ path });
  } catch (error) {
    console.error("campaign-record | relayed media upload failed", error);
    reply({ error: "upload-failed" });
  }
}

/** Requester side: settle the pending promise for this requestId, if ours. */
function handleUploadResult(payload) {
  const entry = typeof payload?.requestId === "string" ? pending.get(payload.requestId) : null;
  if (!entry) return;
  pending.delete(payload.requestId);
  clearTimeout(entry.timer);
  if (typeof payload.path === "string" && payload.path) entry.resolve(payload.path);
  else entry.reject(new RelayUploadError(`campaign-record | relay upload refused: ${payload.error ?? "unknown"}`));
}

/** Listen for relayed upload chunks (active GM) and replies (requester). Call in ready. */
export function registerMediaRelaySocket() {
  game.socket.on(SOCKET_NAME, (payload) => {
    if (payload?.action === UPLOAD_MEDIA_ACTION) {
      if (game.user !== game.users.activeGM) return;
      handleUploadRequest(payload);
    } else if (payload?.action === UPLOAD_MEDIA_RESULT_ACTION) {
      handleUploadResult(payload);
    }
  });
}
```

- [ ] **Step 3: Register in the ready hook**

In `scripts/campaign-record.mjs`, extend the existing import (line 13 area):

```js
import { registerAutoCapture, registerMediaDropSocket } from "./hooks/auto-capture.mjs";
import { registerMediaRelaySocket } from "./hooks/media-relay.mjs";
```

and in the `ready` hook, after `registerMediaDropSocket();`:

```js
  registerMediaRelaySocket();
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: PASS — this task adds runtime-only code (no unit tests possible without Foundry globals; e2e in Task 7 exercises it live).

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/media-relay.mjs scripts/constants.mjs scripts/campaign-record.mjs
git commit -m "feat(relay): GM-side validated upload relay over the module socket"
```

---

### Task 3: `uploadHubMediaAsUser` entry point + surfaced createDirectory failures

**Files:**
- Modify: `scripts/apps/hub/media-upload.mjs`
- Test: `tests/media-upload.test.js` (new)

**Interfaces:**
- Consumes: `relayUploadMedia` from `scripts/hooks/media-relay.mjs` (Task 2).
- Produces (used by Tasks 4 and 5):
  - `uploadHubMediaAsUser(group, file): Promise<string>`
  - `NoActiveGMError` (Error subclass)
  - `uploadHubMedia` unchanged in signature.

- [ ] **Step 1: Write the failing test**

Create `tests/media-upload.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../scripts/hooks/media-relay.mjs", () => ({
  relayUploadMedia: vi.fn(async () => "campaign-record-media/g1/relayed.png")
}));

import { uploadHubMediaAsUser, NoActiveGMError } from "../scripts/apps/hub/media-upload.mjs";
import { relayUploadMedia } from "../scripts/hooks/media-relay.mjs";

const group = { id: "g1" };
const file = new File([new Uint8Array([1, 2, 3])], "map.png", { type: "image/png" });

let upload;
beforeEach(() => {
  upload = vi.fn(async () => ({ path: "campaign-record-media/g1/123-map.png" }));
  globalThis.foundry = {
    applications: { apps: { FilePicker: { implementation: {
      browse: vi.fn(async () => ({})),
      createDirectory: vi.fn(async () => ({})),
      upload
    } } } }
  };
  globalThis.game = {
    user: { can: vi.fn(() => true) },
    users: { activeGM: null }
  };
});
afterEach(() => {
  delete globalThis.foundry;
  delete globalThis.game;
  vi.clearAllMocks();
});

describe("uploadHubMediaAsUser", () => {
  it("uploads directly when the user holds FILES_UPLOAD", async () => {
    const path = await uploadHubMediaAsUser(group, file);
    expect(path).toBe("campaign-record-media/g1/123-map.png");
    expect(upload).toHaveBeenCalledOnce();
    expect(relayUploadMedia).not.toHaveBeenCalled();
  });
  it("relays through the active GM when the user cannot upload", async () => {
    game.user.can = vi.fn((p) => p !== "FILES_UPLOAD");
    game.users.activeGM = { id: "gm" };
    const path = await uploadHubMediaAsUser(group, file);
    expect(path).toBe("campaign-record-media/g1/relayed.png");
    expect(relayUploadMedia).toHaveBeenCalledWith(group, file);
    expect(upload).not.toHaveBeenCalled();
  });
  it("throws NoActiveGMError when neither path is available", async () => {
    game.user.can = vi.fn(() => false);
    game.users.activeGM = null;
    await expect(uploadHubMediaAsUser(group, file)).rejects.toBeInstanceOf(NoActiveGMError);
    expect(upload).not.toHaveBeenCalled();
    expect(relayUploadMedia).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/media-upload.test.js`
Expected: FAIL — `uploadHubMediaAsUser` / `NoActiveGMError` not exported.

- [ ] **Step 3: Implement**

In `scripts/apps/hub/media-upload.mjs`, add the import at the top:

```js
import { relayUploadMedia } from "../../hooks/media-relay.mjs";
```

Replace the two silent `.catch(() => {})` lines inside `uploadHubMedia` with logged variants (behavior otherwise unchanged — already-exists races still surface only as an upload failure):

```js
    await FilePickerImpl.createDirectory("data", "campaign-record-media")
      .catch((err) => console.warn("campaign-record | createDirectory campaign-record-media", err));
    await FilePickerImpl.createDirectory("data", dir)
      .catch((err) => console.warn(`campaign-record | createDirectory ${dir}`, err));
```

Append to the file:

```js
/** Thrown when a user can neither upload directly nor relay through a GM. */
export class NoActiveGMError extends Error {}

/**
 * Upload media as the current user: directly when they hold FILES_UPLOAD,
 * otherwise relayed through the active GM (images only). Throws
 * NoActiveGMError when neither path is available.
 */
export async function uploadHubMediaAsUser(group, file) {
  if (game.user.can("FILES_UPLOAD")) return uploadHubMedia(group, file);
  if (game.users.activeGM) return relayUploadMedia(group, file);
  throw new NoActiveGMError("campaign-record | no active GM to relay the upload");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/media-upload.test.js` then `npm test`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/hub/media-upload.mjs tests/media-upload.test.js
git commit -m "feat(media): uploadHubMediaAsUser routes direct/relay/no-GM"
```

---

### Task 4: Docx import wiring — extract upload helpers, warn without a GM

**Files:**
- Create: `scripts/apps/import-upload.mjs` (move `dataUriToFile` + `uploadInlineImages` out of the wizard, unchanged except as noted)
- Modify: `scripts/apps/import-wizard.mjs`
- Modify: `lang/en.json` (Import section, after the `ImagesDropped` line)
- Test: `tests/import-upload.test.js` (new)

**Interfaces:**
- Consumes: `uploadHubMediaAsUser`, `NoActiveGMError` (Task 3); `parseImageDataUri`, `imageExtension` from `scripts/logic/import-images.mjs`.
- Produces: `uploadInlineImages(html, group, warnings, uploadedByUri): Promise<{html, images}>` — same signature the wizard already calls at `#onCreate`; `dataUriToFile(uri, basename)` exported for reuse.

- [ ] **Step 1: Add i18n key**

In `lang/en.json`, in the `Import` section directly after the `"ImagesDropped"` line:

```json
      "ImagesNeedGM": "No GM is connected and you lack file upload permission — images in this document will be skipped.",
```

- [ ] **Step 2: Write the failing test**

Create `tests/import-upload.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";

vi.mock("../scripts/apps/hub/media-upload.mjs", () => {
  class NoActiveGMError extends Error {}
  return {
    NoActiveGMError,
    uploadHubMediaAsUser: vi.fn(),
    uploadHubMedia: vi.fn()
  };
});

import { uploadInlineImages } from "../scripts/apps/import-upload.mjs";
import { uploadHubMediaAsUser, NoActiveGMError } from "../scripts/apps/hub/media-upload.mjs";

const PNG_URI = `data:image/png;base64,${btoa("fakepng")}`;
const group = { id: "g1" };

beforeEach(() => {
  const dom = new JSDOM("");
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.game = { i18n: { format: (k) => k, localize: (k) => k } };
});
afterEach(() => {
  delete globalThis.DOMParser;
  delete globalThis.game;
  vi.clearAllMocks();
});

describe("uploadInlineImages", () => {
  it("rewrites srcs to the stored path and collects refs", async () => {
    uploadHubMediaAsUser.mockResolvedValue("campaign-record-media/g1/1-i.png");
    const html = `<p><img src="${PNG_URI}" alt="A map"></p>`;
    const warnings = [];
    const out = await uploadInlineImages(html, group, warnings, new Map());
    expect(out.html).toContain('src="campaign-record-media/g1/1-i.png"');
    expect(out.images).toEqual([{ src: "campaign-record-media/g1/1-i.png", caption: "A map" }]);
    expect(warnings).toEqual([]);
  });
  it("uploads identical data-URIs once", async () => {
    uploadHubMediaAsUser.mockResolvedValue("campaign-record-media/g1/1-i.png");
    const html = `<img src="${PNG_URI}"><img src="${PNG_URI}">`;
    await uploadInlineImages(html, group, [], new Map());
    expect(uploadHubMediaAsUser).toHaveBeenCalledTimes(1);
  });
  it("pushes ImagesNeedGM once when no GM can relay", async () => {
    uploadHubMediaAsUser.mockRejectedValue(new NoActiveGMError("no gm"));
    const html = `<img src="${PNG_URI}"><img src="data:image/png;base64,${btoa("other")}">`;
    const warnings = [];
    const out = await uploadInlineImages(html, group, warnings, new Map());
    expect(out.html).not.toContain("<img");
    expect(warnings).toEqual(["CAMPAIGNRECORD.Import.ImagesNeedGM"]);
  });
  it("pushes ImagesDropped for other upload failures", async () => {
    uploadHubMediaAsUser.mockRejectedValue(new Error("boom"));
    const warnings = [];
    await uploadInlineImages(`<img src="${PNG_URI}">`, group, warnings, new Map());
    expect(warnings).toEqual(["CAMPAIGNRECORD.Import.ImagesDropped"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/import-upload.test.js`
Expected: FAIL — `Cannot find module '../scripts/apps/import-upload.mjs'`

- [ ] **Step 4: Create `scripts/apps/import-upload.mjs`**

Move `dataUriToFile` and `uploadInlineImages` verbatim from `import-wizard.mjs:322-395` into the new file with these changes: export both functions, switch the upload call to `uploadHubMediaAsUser`, and split the failure flag into `uploadFailed`/`needsGm`.

```js
import { parseImageDataUri, imageExtension } from "../logic/import-images.mjs";
import { uploadHubMediaAsUser, NoActiveGMError } from "./hub/media-upload.mjs";

/**
 * Build an upload File from an image data-URI. Renderable types upload as-is;
 * unknown-but-decodable types transcode to PNG; undecodable types (EMF/WMF)
 * return { skipped: subtype }.
 */
export async function dataUriToFile(uri, basename) {
  const parsed = parseImageDataUri(uri);
  if (!parsed) return { skipped: "unknown" };
  const bytes = Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0));
  const ext = imageExtension(parsed.subtype);
  if (ext) return { file: new File([bytes], `${basename}.${ext}`, { type: parsed.mime }) };
  // Not directly renderable — best-effort transcode to PNG (EMF/WMF will throw).
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: parsed.mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return { file: new File([await png.arrayBuffer()], `${basename}.png`, { type: "image/png" }) };
  } catch {
    return { skipped: parsed.subtype };
  }
}

/**
 * Upload each inline data-URI image once (mammoth inlines docx images), rewrite
 * srcs to the stored path, and return the collected {src, caption} refs for
 * gallery filing. Identical data-URIs upload once. Per-image failures drop that
 * image with a warning; other images are unaffected. `uploadedByUri` (data-URI ->
 * stored path or null) is supplied by the caller and shared across the whole
 * document, so identical images on different pages are also deduped. Uploads
 * route through uploadHubMediaAsUser, so players without FILES_UPLOAD relay
 * through the active GM; with no GM the images are skipped with their own
 * warning.
 */
export async function uploadInlineImages(html, group, warnings, uploadedByUri) {
  if (!html?.includes("data:image")) return { html, images: [] };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = [...doc.body.querySelectorAll('img[src^="data:"]')];
  if (!imgs.length) return { html, images: [] };

  const images = [];
  let uploadFailed = false;
  let needsGm = false;
  let n = 0;
  for (const img of imgs) {
    const uri = img.getAttribute("src");
    if (!uploadedByUri.has(uri)) {
      const result = await dataUriToFile(uri, `import-${Date.now()}-${++n}`);
      let path = null;
      if (result.skipped) {
        warnings.push(game.i18n.format("CAMPAIGNRECORD.Import.ImageTypeUnsupported", { type: result.skipped }));
      } else {
        try {
          path = await uploadHubMediaAsUser(group, result.file);
        } catch (error) {
          console.warn("campaign-record | inline image upload failed", error);
          if (error instanceof NoActiveGMError) needsGm = true;
          else uploadFailed = true;
        }
      }
      uploadedByUri.set(uri, path);
    }
    const path = uploadedByUri.get(uri);
    if (path) {
      img.setAttribute("src", path);
      const caption = (img.getAttribute("alt") ?? "").trim();
      images.push({ src: path, caption });
    } else {
      img.remove();
    }
  }

  if (needsGm && !warnings.includes(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesNeedGM"))) {
    warnings.push(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesNeedGM"));
  }
  if (uploadFailed) warnings.push(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesDropped"));

  // Dedupe refs by src so the same image inline twice yields one gallery entry.
  const seen = new Set();
  const uniqueImages = images.filter((i) => (seen.has(i.src) ? false : seen.add(i.src)));
  return { html: doc.body.innerHTML, images: uniqueImages };
}
```

- [ ] **Step 5: Rewire the wizard**

In `scripts/apps/import-wizard.mjs`:

1. Delete the moved functions (`dataUriToFile`, `uploadInlineImages`, lines 322-395) and the now-unused imports `parseImageDataUri`, `imageExtension` (keep `assignTimepoints`) and `uploadHubMedia` (line 8). Add:

```js
import { uploadInlineImages } from "./import-upload.mjs";
```

2. In `#onFileChosen`, right after the `splitSections` empty-check block (after the `NoSections` early return), add the up-front warning:

```js
    if (parsed.html.includes("data:image") && !game.user.can("FILES_UPLOAD") && !game.users.activeGM) {
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesNeedGM"));
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/import-upload.test.js` then `npm test`
Expected: PASS; full suite (including `i18n-coverage`) green.

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/import-upload.mjs scripts/apps/import-wizard.mjs lang/en.json tests/import-upload.test.js
git commit -m "feat(import): docx image uploads route through the GM relay for players"
```

---

### Task 5: Hub drag-drop wiring — relay for players, images-only guard

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (import line 20; `#onMediaFilesDrop`, lines 700-733)
- Modify: `lang/en.json` (Hub section)

**Interfaces:**
- Consumes: `uploadHubMediaAsUser` (Task 3), `isRelayableImageType` (Task 1).
- Produces: no new exports — behavior change only.

- [ ] **Step 1: Update i18n**

In `lang/en.json`, Hub section: replace the `DropCannotUpload` value and add one key after `DropSkippedFile`:

```json
      "DropRelayImagesOnly": "\"{name}\" skipped — only images can be uploaded through a GM relay.",
```

```json
      "DropCannotUpload": "You lack permission to upload files and no GM is connected — media can't be uploaded.",
```

- [ ] **Step 2: Rewire the drop handler**

In `scripts/apps/hub/hub-mixin.mjs`, change line 20's import:

```js
import { uploadHubMediaAsUser } from "./media-upload.mjs";
```

Add alongside the other logic imports (after line 17):

```js
import { isRelayableImageType } from "../../logic/media-relay.mjs";
```

In `#onMediaFilesDrop`, replace the permission gate (lines 705-707):

```js
      const canUploadDirect = game.user.can("FILES_UPLOAD");
      if (!canUploadDirect && !game.users.activeGM) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.DropCannotUpload"));
      }
```

and replace the upload loop (lines 722-732):

```js
      for (const file of accepted) {
        // The relay carries images only; players without upload rights skip videos.
        if (!canUploadDirect && !isRelayableImageType(file.type)) {
          ui.notifications.warn(game.i18n.format("CAMPAIGNRECORD.Hub.DropRelayImagesOnly", { name: file.name }));
          continue;
        }
        let path;
        try {
          path = await uploadHubMediaAsUser(group, file);
        } catch (error) {
          console.error("campaign-record | media upload failed", error);
          ui.notifications.error(game.i18n.format("CAMPAIGNRECORD.Hub.DropUploadFailed", { name: file.name }));
          continue;
        }
        await this.#attachDroppedMedia(target, group, file.name, path);
      }
```

(A GM disconnecting mid-flight surfaces as the existing `DropUploadFailed` path via the relay timeout — no extra handling.)

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS (i18n-coverage picks up the new/changed keys; no unit tests target the mixin — e2e covers it in Task 7).

- [ ] **Step 4: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs lang/en.json
git commit -m "feat(hub): drag-drop media relays through the GM for players without upload rights"
```

---

### Task 6: Serialize `RecordPane.mount`

**Files:**
- Create: `scripts/logic/mount-queue.mjs`
- Modify: `scripts/apps/hub/record-pane.mjs`
- Test: `tests/mount-queue.test.js` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `createSerialQueue(): { run(task: () => Promise<any>, opts?: {supersede?: boolean}): Promise<any> }` — used only by `record-pane.mjs`. `RecordPane.mount`/`close` signatures unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/mount-queue.test.js`:

```js
import { describe, it, expect } from "vitest";
import { createSerialQueue } from "../scripts/logic/mount-queue.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createSerialQueue", () => {
  it("runs tasks strictly one at a time, in order", async () => {
    const q = createSerialQueue();
    const log = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const a = q.run(async () => { log.push("a:start"); await gate; log.push("a:end"); },
      { supersede: false });
    const b = q.run(async () => { log.push("b"); }, { supersede: false });
    await tick();
    expect(log).toEqual(["a:start"]); // b waits for a
    release();
    await Promise.all([a, b]);
    expect(log).toEqual(["a:start", "a:end", "b"]);
  });
  it("skips a superseded task when a newer one was submitted", async () => {
    const q = createSerialQueue();
    const log = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const a = q.run(async () => { await gate; log.push("a"); }, { supersede: false });
    const b = q.run(async () => { log.push("b"); });          // superseded by c
    const c = q.run(async () => { log.push("c"); });
    release();
    expect(await b).toBeUndefined();
    await Promise.all([a, c]);
    expect(log).toEqual(["a", "c"]);
  });
  it("a supersede:false task always runs, and later tasks still run after it", async () => {
    const q = createSerialQueue();
    const log = [];
    const m = q.run(async () => { log.push("mount"); });
    const cl = q.run(async () => { log.push("close"); }, { supersede: false });
    await Promise.all([m, cl]);
    // close (newer) superseded the queued mount and still ran itself
    expect(log).toEqual(["close"]);
  });
  it("propagates errors to the caller without wedging the chain", async () => {
    const q = createSerialQueue();
    await expect(q.run(async () => { throw new Error("boom"); }, { supersede: false }))
      .rejects.toThrow("boom");
    const after = await q.run(async () => "ok", { supersede: false });
    expect(after).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mount-queue.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the queue**

Create `scripts/logic/mount-queue.mjs`:

```js
/**
 * Serialize async tasks so no two ever overlap, letting newer submissions
 * supersede queued ones: run(task) chains task behind all prior tasks; by
 * default a task that is no longer the most recent submission when its turn
 * arrives is skipped (resolves undefined). supersede:false tasks always run
 * (used for close, which must never be skipped). Errors reach run()'s caller
 * but never wedge the chain. No Foundry globals — unit-tested with vitest.
 */
export function createSerialQueue() {
  let chain = Promise.resolve();
  let latest = 0;
  return {
    run(task, { supersede = true } = {}) {
      const token = ++latest;
      const result = chain.then(() => {
        if (supersede && token !== latest) return undefined;
        return task();
      });
      chain = result.catch(() => {});
      return result;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mount-queue.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into RecordPane**

In `scripts/apps/hub/record-pane.mjs`, add the import:

```js
import { createSerialQueue } from "../../logic/mount-queue.mjs";
```

Rename the existing method bodies to private implementations and route both public methods through one queue. The class becomes:

```js
export class RecordPane {
  #sheets = new Map(); // "pageUuid:mode" -> sheet instance

  // The hub's _onRender fires mount() fire-and-forget on every render pass;
  // an import's hook burst produces overlapping passes, and two interleaved
  // mounts re-parent a sheet whose <prose-mirror> is mid-initialization
  // (destroying its EditorView under a live render). Serialize: one mount or
  // close at a time, and a queued mount that a newer call has superseded is
  // skipped instead of touching the DOM.
  #queue = createSerialQueue();

  mount(container, page, mode) {
    return this.#queue.run(() => this.#mount(container, page, mode));
  }

  close() {
    return this.#queue.run(() => this.#close(), { supersede: false });
  }

  async #mount(container, page, mode) {
    // Superseded-by-close mounts can arrive after the hub swapped views; a
    // container no longer in the document has nothing to mount into.
    if (!container.isConnected) return;
    const key = `${page.uuid}:${mode}`;
    // One live embedded sheet at a time: close all others (mode flips included).
    for (const [k, sheet] of [...this.#sheets]) {
      if (k === key) continue;
      await sheet.close({ animate: false });
      this.#sheets.delete(k);
    }
    let sheet = this.#sheets.get(key);
    if (!sheet) {
      const inHubGroup = page.parent?.getFlag("core", "sheetClass") === GROUP_SHEET_CLASS;
      const isMarkdown = page.text?.format === CONST.JOURNAL_ENTRY_PAGE_FORMATS.MARKDOWN;
      const cls = (page.type === "text" && inHubGroup && !isMarkdown)
        ? TextPageSheet
        : page._getSheetClass();
      sheet = new cls({
        id: `campaign-record-pane-${page.id}-${mode}`,
        document: page,
        mode,
        ...(mode === "view" ? { tag: "div" } : {}),
        window: { frame: false, positioned: false }
      });
      this.#sheets.set(key, sheet);
    }
    let fresh = false;
    if (!sheet.rendered) {
      await sheet.render({ force: true });
      fresh = true;
    }
    sheet.element.classList.add("record-pane-sheet");
    // Re-appending an element that is already this container's child would
    // still disconnect + reconnect it (killing active editors) — skip.
    if (sheet.element.parentElement === container) return;
    container.replaceChildren(sheet.element);
    // Re-parenting a live sheet disconnects any active always-open
    // <prose-mirror>: core's disconnectedCallback saves + destroys the editor
    // and its #active flag stays true, so it can never reactivate on
    // reconnect. Rebuild the sheet's DOM so editors come back alive.
    if (!fresh) await sheet.render({ force: true });
  }

  async #close() {
    for (const sheet of this.#sheets.values()) await sheet.close({ animate: false });
    this.#sheets.clear();
  }
}
```

(`#mount`'s body is the current `mount` body verbatim plus the `isConnected` guard; `#close`'s is the current `close` body verbatim. `hub-mixin.mjs:1027` needs no change — its `.catch` still guards real errors, and skipped stale mounts resolve `undefined`.)

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/mount-queue.mjs scripts/apps/hub/record-pane.mjs tests/mount-queue.test.js
git commit -m "fix(hub): serialize record-pane mounts so render bursts can't destroy live editors"
```

---

### Task 7: End-to-end coverage

**Files:**
- Create: `tests/e2e/30-player-media-relay.spec.mjs`

**Interfaces:**
- Consumes: everything above, plus e2e helpers `login`, `deleteGroupsByPrefix` from `tests/e2e/helpers/foundry.mjs`; test world users `Gamemaster` and `User 1`.
- Deviation from the spec's test list, deliberate: the spec's "player imports a docx with images" scenario is replaced by (a) the player drag-drop relay test (same `uploadHubMediaAsUser` → relay path end-to-end) and (b) Task 4's unit tests of the import wiring — the checked-in docx fixture (`adventure-notes.docx`) contains no images, and authoring a new image-bearing docx fixture is not worth the maintenance. The mount-race check drives `RecordPane.mount` concurrently against real ProseMirror instead of a large-doc import, which makes the regression deterministic.

- [ ] **Step 1: Read the e2e contract**

Invoke the `campaign-record:foundry-e2e` skill and follow it (session locking, server start, symlink ownership) before running anything.

- [ ] **Step 2: Write the spec**

Create `tests/e2e/30-player-media-relay.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

// Player without FILES_UPLOAD adds media through the GM relay; without a GM
// the paths degrade to clear warnings; RecordPane.mount survives concurrent
// calls without destroying live ProseMirror editors.
const P = "E2E Relay";

// 1x1 transparent PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const dropFile = (page, selector, filename) =>
  page.evaluate(({ selector, filename, b64 }) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], filename, { type: "image/png" }));
    const el = document.querySelector(selector);
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { selector, filename, b64: PNG_B64 });

async function loginGm(browser) {
  const page = await browser.newPage();
  await login(page, "Gamemaster");
  return page;
}

test.describe("player media upload via GM relay", () => {
  let gmPage;
  let playerPage;
  let priorUploadRoles;

  test.beforeAll(async ({ browser }) => {
    gmPage = await loginGm(browser);
    // Ensure the player role genuinely lacks FILES_UPLOAD for this world,
    // whatever its current configuration; restored in afterAll.
    priorUploadRoles = await gmPage.evaluate(async () => {
      const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
      const prior = [...(perms.FILES_UPLOAD ?? [])];
      perms.FILES_UPLOAD = [CONST.USER_ROLES.ASSISTANT, CONST.USER_ROLES.GAMEMASTER];
      await game.settings.set("core", "permissions", perms);
      return prior;
    });
    playerPage = await browser.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async ({ browser }) => {
    if (!gmPage || gmPage.isClosed()) gmPage = await loginGm(browser);
    await gmPage.evaluate(async (prior) => {
      const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
      perms.FILES_UPLOAD = prior;
      await game.settings.set("core", "permissions", perms);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", "");
    }, priorUploadRoles);
    await deleteGroupsByPrefix(gmPage, P);
    if (playerPage && !playerPage.isClosed()) await playerPage.close();
    await gmPage.close();
  });

  test("player without FILES_UPLOAD drops an image and the GM relays the upload", async () => {
    const { groupId } = await gmPage.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = await createGroup(`${P} Drop`);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
      await addTimepoint(group, `${P} TP1`);
      return { groupId: group.id };
    }, P);

    // Sanity: the permission override actually bit.
    expect(await playerPage.evaluate(() => game.user.can("FILES_UPLOAD"))).toBe(false);
    expect(await playerPage.evaluate(() => !!game.users.activeGM)).toBe(true);

    await playerPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    await playerPage.waitForSelector("#campaign-hub .window-content");

    await dropFile(playerPage, "#campaign-hub .window-content", "relayed.png");

    // The GM client uploads into campaign-record-media/<groupId>/ and the
    // gallery filing lands via the existing drop-media relay.
    await expect.poll(() => gmPage.evaluate((groupId) => {
      const g = game.journal.get(groupId);
      const gallery = g.pages.find((p) => p.type === "campaign-record.media");
      const img = gallery?.system.images.find((i) => i.src.includes("relayed"));
      return img?.src ?? null;
    }, groupId), { timeout: 30_000 }).toContain(`campaign-record-media/${groupId}/`);
  });

  test("concurrent RecordPane.mount calls never crash a live editor", async () => {
    const errors = [];
    gmPage.on("pageerror", (err) => errors.push(String(err)));
    await gmPage.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { RecordPane } = await import("/modules/campaign-record/scripts/apps/hub/record-pane.mjs");
      const group = await createGroup(`${P} Race`);
      const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
        { name: `${P} Notes`, type: "text", text: { content: "<p>hello</p>", format: 1 } }
      ]);
      const container = document.createElement("div");
      document.body.append(container);
      const pane = new RecordPane();
      // Pre-fix, interleaved mounts re-parent a sheet whose editor is mid-init
      // and throw replaceWith/matchesNode TypeErrors from ProseMirror.
      await Promise.all([
        pane.mount(container, page, "edit"),
        pane.mount(container, page, "view"),
        pane.mount(container, page, "edit"),
        pane.mount(container, page, "view"),
        pane.mount(container, page, "edit")
      ]);
      await new Promise((r) => setTimeout(r, 1000));
      await pane.close();
      container.remove();
    }, P);
    expect(errors).toEqual([]);
  });

  test("player drop with no GM online degrades to a clear warning", async () => {
    // Last scenario: disconnect the GM so activeGM goes null on the player.
    await gmPage.close();
    await playerPage.waitForFunction(() => !game.users.activeGM, null, { timeout: 30_000 });

    await playerPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    await playerPage.waitForSelector("#campaign-hub .window-content");
    await dropFile(playerPage, "#campaign-hub .window-content", "orphan.png");

    await expect(playerPage.locator("#notifications .notification", {
      hasText: "no GM is connected"
    }).first()).toBeVisible({ timeout: 15_000 });
  });
});
```

- [ ] **Step 3: Run the new spec**

Per the foundry-e2e contract: `npm run test:e2e -- tests/e2e/30-player-media-relay.spec.mjs`
Expected: 3 passed. If the relay test times out, check the GM page's console for `campaign-record | relayed media upload failed` — that indicates GM-side validation or FilePicker failure, not socket plumbing.

- [ ] **Step 4: Run the full suites**

Run: `npm test` and the full `npm run test:e2e` (per the e2e contract — the existing 28-hub-media-drop and 21-import-export specs exercise the modified drop/import paths as the GM).
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/30-player-media-relay.spec.mjs
git commit -m "test(e2e): player relay upload, no-GM degradation, mount-race regression"
```

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("la extensión se autentica con un token revocable y guarda sin texto libre", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-extension-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const { getDb } = await import(`../lib/db?extension=${Date.now()}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Santiago', 'x', '#000', ?)").run(now);
  const { createExtensionToken, revokeExtensionToken } = await import(`../lib/extension-auth?extension=${Date.now()}`);
  const token = createExtensionToken("profile");
  const { POST } = await import(`../app/api/extension/capture/route?extension=${Date.now()}`);
  const request = () => new Request("http://localhost:3000/api/extension/capture", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: "moz-extension://lumina-test" },
    body: JSON.stringify({ url: "https://github.com/example/project", title: "Proyecto TypeScript", description: "Código abierto", tagCatalogKeys: ["tag_primary_tecnologia_y_desarrollo", "tag_secondary_programacion"], mode: "save" }),
  });
  const response = await POST(request());
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "moz-extension://lumina-test");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM videos").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM video_tags").get() as { count: number }).count, 2);
  revokeExtensionToken("profile");
  assert.equal((await POST(request())).status, 401);
  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

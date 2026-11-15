import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAppServer } from "./server.mjs";
import { validateWorkspace, loadWorkspace } from "./public/storage.js";
import { once } from "node:events";
const server = createAppServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
try {
  const legacyRoute = await fetch(base + "/recipe/edit/test?timeline=project", {redirect:"manual"});
  assert.equal(legacyRoute.status, 302);
  assert.equal(legacyRoute.headers.get("location"), "/#/recipe/edit/test?timeline=project");
  for (const path of [
    "/",
    "/recipes",
    "/project/test",
    "/recipe/new/test",
    "/recipe/edit/test",
    "/app.js",
    "/timeline-model.js",
    "/storage.js",
    "/style.css",
  ]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    const body = await res.text();
    assert.ok(body.length);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      res.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    const head = await fetch(base + path, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(
      head.headers.get("content-length"),
      res.headers.get("content-length"),
    );
    const cached = await fetch(base + path, {
      headers: { "If-None-Match": res.headers.get("etag") },
    });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), "");
  }
  const html = await (await fetch(base + "/")).text();
  assert.ok(!html.includes('href="data:,"'));
  const iconLinks = [...html.matchAll(/<link\b[^>]*rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/g)];
  assert.equal(iconLinks.length, 4);
  for (const [name, size] of [
    ["favicon.ico", null],
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
    ["favicon-48x48.png", 48],
    ["apple-touch-icon.png", 180],
  ]) {
    const path = "/" + name;
    const res = await fetch(base + path, { headers: { "Accept-Encoding": "identity" } });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("content-type"), size ? "image/png" : "image/x-icon");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    const body = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(body, await readFile(new URL("./public/" + name, import.meta.url)));
    if (size) {
      assert.equal(body.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(body.readUInt32BE(16), size);
      assert.equal(body.readUInt32BE(20), size);
    } else {
      assert.equal(body.readUInt16LE(2), 1);
      assert.equal(body.readUInt16LE(4), 3);
      assert.deepEqual([0, 1, 2].map(i => body[6 + i * 16]), [16, 32, 48]);
    }
    const head = await fetch(base + path, { method: "HEAD", headers: { "Accept-Encoding": "identity" } });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    for (const header of ["content-type", "content-length", "etag", "cache-control"])
      assert.equal(head.headers.get(header), res.headers.get(header));
    for (const method of ["GET", "HEAD"]) {
      const cached = await fetch(base + path, { method, headers: { "Accept-Encoding": "identity", "If-None-Match": res.headers.get("etag") } });
      assert.equal(cached.status, 304);
      assert.equal((await cached.arrayBuffer()).byteLength, 0);
    }
  }
  for (const [link] of iconLinks) {
    const href = /href="([^"]+)"/.exec(link)[1];
    assert.ok(href.startsWith("./"));
    const resolved = new URL(href, "https://hasan-m-y.github.io/mise_studio/");
    assert.ok(resolved.pathname.startsWith("/mise_studio/"));
    await readFile(new URL("./public/" + resolved.pathname.slice("/mise_studio/".length), import.meta.url));
  }
  const compressed = await fetch(base + "/app.js", {
    headers: { "Accept-Encoding": "gzip" },
  });
  const plain = await fetch(base + "/app.js", {
    headers: { "Accept-Encoding": "identity" },
  });
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.ok(
    Number(compressed.headers.get("content-length")) <
      Number(plain.headers.get("content-length")),
  );
  assert.equal(await compressed.text(), await plain.text());
  for (const path of [
    "/.env",
    "/server.mjs",
    "/../server.mjs",
    "/%2e%2e/server.mjs",
    "/missing",
    "/api/import-recipe",
    "/api/recipes",
  ])
    assert.equal((await fetch(base + path)).status, 404, path);
  const post = await fetch(base + "/", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
} finally {
  server.close();
  server.closeAllConnections();
  await once(server, "close");
}
const good = {
  projects: {
    p: { id: "p", name: "Dinner", guests: 4, date: "2026-09-07", courses: [] },
  },
  recipes: {},
  drafts: {},
};
assert.equal(validateWorkspace(good).projects.p.name, "Dinner");
assert.equal(Object.getPrototypeOf(validateWorkspace(good).projects), null);
assert.throws(() => validateWorkspace({ projects: [] }));
assert.throws(() =>
  validateWorkspace({
    projects: { p: { ...good.projects.p, guests: '"><img src=x>' } },
  }),
);
assert.throws(() =>
  validateWorkspace({
    projects: {
      p: {
        ...good.projects.p,
        courses: [{ id: 'bad"id', name: "", time: "", dishes: [] }],
      },
    },
  }),
);
assert.equal(
  loadWorkspace(
    {
      getItem: (k) =>
        k === "mise-studio-projects-v1" ? JSON.stringify(good.projects) : null,
    },
    "current",
  ).projects.p.name,
  "Dinner",
);
assert.throws(() => loadWorkspace({ getItem: () => "{invalid" }, "current"));
console.log(
  "PASS: production HTTP routes, favicon assets and subpath links, HEAD, conditional caching, security headers, private-file denial, removed endpoints, method handling, legacy storage migration, schema validation and safe record maps.",
);

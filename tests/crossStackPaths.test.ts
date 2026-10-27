import assert from "node:assert/strict";
import { test } from "node:test";
import { HOLE, isCatchAll, joinPaths, parsePath, reaches } from "../src/rules/crossStack/paths.ts";

const path = (raw: string) => parsePath(raw)!;

test("parsePath: every framework's parameter style is the same", () => {
  for (const raw of ["/users/:id", "/users/{id}", "/users/{id:int}", "/users/<int:id>", "/users/<id>", "/users/[id]", `/users/${HOLE}`]) {
    assert.deepEqual(path(raw).segments, ["users", "*"], raw);
  }
  assert.deepEqual(path("/files/{*splat}").segments, ["files", "**"]);
  assert.deepEqual(path("/docs/[...slug]").segments, ["docs", "**"]);
});

test("parsePath: local hosts, queries and unknown prefixes", () => {
  assert.deepEqual(path("http://127.0.0.1:8000/chat").segments, ["chat"]);
  assert.deepEqual(path("http://172.24.147.103:1337/auth/signIn").segments, ["auth", "signIn"]);
  assert.deepEqual(path("/api/news/travel?count=9").segments, ["api", "news", "travel"]);
  assert.deepEqual(path("/api/items/").segments, ["api", "items"]);
  const tail = path(`${HOLE}/usage`);
  assert.equal(tail.unknownPrefix, true);
  assert.equal(tail.text, "…/usage");
  assert.equal(path(`/api/users/${HOLE}/avatar`).text, "/api/users/…/avatar");
});

test("parsePath: ignores what isn't this app's API", () => {
  for (const raw of ["https://api.openai.com/v1/chat", "http://172.32.0.1/x", "/logo.png", "/data.json", "chat", "#top", HOLE, `${HOLE}/${HOLE}`]) {
    assert.equal(parsePath(raw), undefined, raw);
  }
});

test("reaches: same length, params match anything, catch-alls take the rest", () => {
  assert.ok(reaches(path("/api/users/42"), path("/api/users/:id")));
  assert.ok(reaches(path(`/api/users/${HOLE}`), path("/api/users/{id}")));
  assert.ok(!reaches(path("/api/users"), path("/api/users/:id")));
  assert.ok(!reaches(path("/api/user/1"), path("/api/users/:id")));
  assert.ok(reaches(path("/files/a/b/c"), path("/files/{*splat}")));
  assert.ok(reaches(path(`${HOLE}/usage`), path("/api/agent/usage")));
  assert.ok(!reaches(path(`${HOLE}/usage`), path("/api/agent/credits")));
  assert.ok(isCatchAll(path("/{*splat}")));
});

test("joinPaths: prefixes and slashes", () => {
  assert.equal(joinPaths("/api/", "/chat"), "/api/chat");
  assert.equal(joinPaths("/api", "/"), "/api");
  assert.equal(joinPaths("", "/"), "/");
  assert.equal(joinPaths("api", "articles/"), "/api/articles");
});

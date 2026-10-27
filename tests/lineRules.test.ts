import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "./helpers.ts";

test("catch blocks: JS", async () => {
  assert.deepEqual(await check("server/jobs.js", `
try { a(); } catch (e) { throw e; }
try { a(); } catch (err) { console.error("failed", err); }
try { a(); } catch {}
try { a(); } catch { /* ignore */ }
try { a(); } catch { /* best effort: the next sync retries */ }
function load() {
  try { return a(); } catch (e) { console.warn(e); return null; }
}
try { a(); } catch (e) { throw new Error("wrapped", { cause: e }); }
try { a(); } catch (e) { res.status(500).json({ error: e.message }); }
`), [
    "2 catch-rethrow sure",
    "3 catch-only-logs maybe",
    "4 empty-catch likely",
    "5 empty-catch likely",
    "8 catch-returns-default maybe",
  ]);
});

test("catch blocks: an error only logged in browser code is one the user never sees", async () => {
  assert.deepEqual(await check("src/pages/Inbox.tsx", 'try { a(); } catch (e) { console.error("Failed to delete", e); }\n'), [
    "1 catch-only-logs likely",
  ]);
});

test("catch blocks: Python", async () => {
  assert.deepEqual(await check("agents/utils.py", `
try:
    a()
except Exception:
    pass

try:
    a()
except json.JSONDecodeError:
    pass

try:
    a()
except Exception as e:
    raise

try:
    a()
except ValueError:
    raise
except Exception as e:
    print(e)

def search(q):
    try:
        return a(q)
    except Exception as e:
        print(f"Request error: {e}")
        return None
`), [
    "4 empty-catch likely",
    "9 empty-catch maybe",
    "14 catch-rethrow sure",
    "21 catch-only-logs maybe",
    "27 catch-returns-default maybe",
  ]);
});

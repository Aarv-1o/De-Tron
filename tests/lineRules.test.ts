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

test("commented-out code: blocks are sure, single lines likely, prose and directives skipped", async () => {
  assert.deepEqual(await check("agents/chatbot.py", `
# checkpointer = InMemorySaver()

# builder = StateGraph(AgentState)
# builder.add_node("Chatbot", chatbot_node)
x = 1
#search_key=os.getenv("SEARCH_KEY")
# html=True enables serving index.html for directory paths
# TODO: x = compute()
y = 2  # noqa: E501
`, "commented-out-code"), ["2 commented-out-code sure", "7 commented-out-code likely"]);

  assert.deepEqual(await check("src/app.ts", `
// const old = load();
// eslint-disable-next-line no-console
// lets a broker dismiss it early; it stays hidden afterwards
// return cached;
const a = 1;
`, "commented-out-code"), ["2 commented-out-code likely", "5 commented-out-code likely"]);
});

test("comments that repeat the code, but not ones that explain why, or section headers", async () => {
  assert.deepEqual(await check("src/firebase.js", `
// Initialize Firebase
const app = initializeApp(firebaseConfig);
// Encrypt the access token for storage
const encryptedToken = encrypt(accessToken);
// Retry once because the first call after deploy often times out
const res = await fetchClients();
// ─── Rate Limiting ───
const authLimiter = rateLimit({});
// Done
start();
`, "comment-repeats-code"), ["2 comment-repeats-code likely", "4 comment-repeats-code likely"]);
});

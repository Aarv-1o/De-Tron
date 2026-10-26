// Repeated setup in tests is deliberate.
export function makeFixtureUser(overrides = {}) {
  const base = { name: "Bea Broker", email: "bea@example.com", company: "Acme Realty", plan: "free" };
  const merged = { ...base, ...overrides };
  if (!merged.email.includes("@")) throw new Error("bad email");
  return merged;
}

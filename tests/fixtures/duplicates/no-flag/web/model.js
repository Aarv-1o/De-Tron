// Tiny look-alike methods are normal, not copies.
export class User {
  getName() { return this.name; }
  getEmail() { return this.email; }
}
export class Team {
  getName() { return this.name; }
}

// Same name, different job.
export function handler(req) {
  const id = req.params.id;
  if (!id) throw new Error("missing id");
  return { id, at: Date.now(), source: "web", ok: true, tags: ["a", "b"] };
}

// One-word names shared across languages mean nothing.
export function main() {
  const args = process.argv.slice(2);
  for (const a of args) console.info(`arg: ${a}`);
  return args.length;
}

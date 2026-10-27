import { collector, walk, type FileContext, type LineFinding } from "../line/types.ts";
import { userInputIn } from "./taint.ts";

// The browser and the edges of the server: XSS sinks (86% of AI code failed XSS-prone tasks,
// Veracode 2025), CORS that lets any site use a user's session, internals leaked in error
// responses, debug mode, and the auth details AI gets subtly wrong.

const SANITIZED = /sanitize|purify|DOMPurify|escape|encode|xss\(|textContent/i;
const HASHING = /bcrypt|argon2|scrypt|pbkdf2|passlib|werkzeug\.security|make_password|hashpw|generate_password_hash|crypt\(/i;

export function webRules({ parsed, file, frontend }: FileContext): LineFinding[] {
  const python = parsed.language === "python";
  const { found, add } = collector(file);
  const source = parsed.source;
  for (const node of walk(parsed.tree.rootNode)) {
    const text = node.text;
    // XSS: <div dangerouslySetInnerHTML={{ __html: x }} />, el.innerHTML = x, insertAdjacentHTML.
    if (node.type === "jsx_attribute" && /^dangerouslySetInnerHTML\b/.test(text)) {
      const value = /__html\s*:\s*([\s\S]*?)\s*\}\s*\}?$/.exec(text)?.[1] ?? "";
      if (value && !/^["'`][^$]*["'`]$/.test(value) && !SANITIZED.test(value)) add(node, "xss", "likely", `dangerouslySetInnerHTML renders ${value.slice(0, 40)} as HTML without sanitizing it`);
    }
    if (node.type === "assignment_expression" && /\.(innerHTML|outerHTML)$/.test(node.childForFieldName("left")?.text ?? "")) {
      const right = node.childForFieldName("right")!;
      const built = right.type === "template_string" ? right.namedChildren.some((c) => c.type === "template_substitution") : right.type !== "string";
      const constant = /^[A-Z][A-Z0-9_]*$/.test(right.text);
      if (built && !constant && !SANITIZED.test(right.text) && !/^["'`]\s*["'`]$/.test(right.text)) {
        add(node, "xss", right.type === "identifier" || right.type === "member_expression" ? "maybe" : "likely", `${node.childForFieldName("left")!.text} is set from data: any <script> or onerror= in it runs`);
      }
    }
    if (node.type === "call" && /^(render_template_string|Template)$/.test(node.childForFieldName("function")?.text ?? "")) {
      const arg = node.childForFieldName("arguments")?.namedChildren[0];
      if (arg && arg.type !== "string" && userInputIn(arg, true)) add(node, "xss", "likely", "render_template_string() renders a template built from user input (server-side template injection)");
    }
    // CORS: any origin AND cookies/credentials means any site can act as the logged-in user.
    if ((node.type === "object" || node.type === "argument_list") && /credentials\s*[:=]\s*(true|True)|allow_credentials\s*=\s*True/.test(text)
      && /origin\s*:\s*(["']\*["']|true)|allow_origins\s*=\s*\[\s*["']\*["']\s*\]/.test(text) && text.length < 600) {
      add(node, "cors-any-origin-with-credentials", "likely", "CORS allows any origin with credentials: any website can call your API as the logged-in user");
    }
    // Stack traces and raw errors in responses (Alice & Bob ch. 4: never show them to users).
    if (!frontend && (node.type === "call_expression" || node.type === "call")) {
      const callee = node.childForFieldName("function")?.text ?? "";
      const args = node.childForFieldName("arguments")?.text ?? "";
      if (/\.(json|send)$|^(HTTPException|JSONResponse|jsonify|Response)$/.test(callee)) {
        // Sent only outside production (NODE_ENV checks): fine.
        const devOnly = /NODE_ENV|production|DEBUG|isDev/.test(node.parent?.parent?.text.slice(0, 600) ?? args);
        const errorStatus = /status\(\s*5\d\d|status_code\s*=\s*5\d\d|HTTPException\(\s*(status_code\s*=\s*)?5\d\d/.test(node.parent?.text ?? node.text) || /^HTTPException|^JSONResponse/.test(callee);
        if (!devOnly && /\b(err|error|ex|exc)\.stack\b|traceback\.format_exc\(\)/.test(args)) add(node, "error-leak", "likely", "The response includes a stack trace: it shows attackers your code and versions");
        else if (!devOnly && errorStatus && /^\(\s*\{?\s*\w*\s*:?\s*(err|error|ex|exc)\s*\}?\s*\)$/.test(args)) add(node, "error-leak", "maybe", "The response includes the raw error object");
      }
    }
    // Debug mode on in code: Flask's debugger runs any Python it's sent.
    if (node.type === "call" && /\.run$/.test(node.childForFieldName("function")?.text ?? "") && /debug\s*=\s*True/.test(text)) add(node, "debug-mode", "likely", "app.run(debug=True): the debugger lets anyone who reaches it run code");
    if (python && /(^|\/)settings\.py$/.test(file) && node.type === "expression_statement" && /^DEBUG\s*=\s*True\b/.test(text)) add(node, "debug-mode", "likely", "DEBUG = True is written in settings: error pages show code, settings and SQL");
    // Weak password hashing: md5/sha1/sha256 of a password (fast hashes are brute-forced quickly).
    if ((node.type === "call_expression" || node.type === "call") && /createHash\(\s*["'](md5|sha1|sha256|sha512)["']\s*\)|hashlib\.(md5|sha1|sha256|sha512)\(/.test(text) && /passw|pwd/i.test(text) && !node.parent?.text.startsWith(text + ".")) {
      add(node, "weak-password-hash", "likely", "Password hashed with a fast hash (md5/sha): use bcrypt, argon2 or scrypt");
    }
    // jwt.decode() doesn't check the signature: anyone can write the token.
    if ((node.type === "call_expression" || node.type === "call") && /^(jwt\.decode|jose\.decodeJwt|jwt_decode|jwtDecode)$/.test(node.childForFieldName("function")?.text ?? "")) {
      const insecure = python ? /verify_signature["']?\s*:\s*False|algorithms\s*=\s*\[\s*["']none/i.test(text) : !/jwt\.verify|jwtVerify|verifyToken/.test(source);
      if (insecure && !frontend) add(node, "jwt-not-verified", "likely", `${node.childForFieldName("function")!.text}() reads the token without checking its signature: anyone can forge one`);
    }
    // Math.random() for tokens, codes and passwords: predictable.
    if (node.type === "variable_declarator" || node.type === "assignment" || node.type === "pair") {
      const name = (node.childForFieldName("name") ?? node.childForFieldName("left") ?? node.childForFieldName("key"))?.text ?? "";
      const value = (node.childForFieldName("value") ?? node.childForFieldName("right"))?.text ?? "";
      if (/(token|secret|passw|otp|code|nonce|salt|reset|invite|session|api_?key)/i.test(name) && /Math\.random\(\)|\brandom\.(random|randint|choice|choices)\(/.test(value)) {
        add(node, "insecure-random", "likely", `${name} comes from Math.random()/random: it can be predicted. Use crypto.randomBytes / secrets`);
      }
    }
  }
  // Passwords stored as typed: a create/update with the password, and no hashing anywhere in the file.
  if (!frontend && !HASHING.test(source) && /\bpassword\b/.test(source)) {
    for (const node of walk(parsed.tree.rootNode)) {
      if (!/^(create|insert|insertOne|save|update|updateOne|objects\.create|create_user)$/.test(node.childForFieldName?.("function")?.text.split(".").slice(-1)[0] ?? "")) continue;
      if (/\bpassword\s*[:=]\s*(req\.body\.password|password|data\[?["']?password|body\.password|request\.\w+\[?["']password)/.test(node.text)) {
        add(node, "plaintext-password", "likely", "A password is saved as typed, with no hashing in this file");
      }
    }
  }
  return found;
}

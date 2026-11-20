import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
dotenv.config();

function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Run this command from an interactive terminal.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = input.isRaw;
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
    };

    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Admin setup cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += character;
        process.stdout.write("*");
      }
    };

    input.on("data", onData);
  });
}

async function createAdmin() {
  const emailArgument = process.argv[2];
  if (emailArgument === "--help" || emailArgument === "-h") {
    console.log("Usage: npm run admin:create -- <email> [--confirm-production]");
    return;
  }
  if (!emailArgument || emailArgument.startsWith("--")) {
    throw new Error(
      "Usage: npm run admin:create -- <email> [--confirm-production]",
    );
  }

  const email = emailArgument.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  if (
    process.env.NODE_ENV === "production" &&
    !process.argv.includes("--confirm-production")
  ) {
    throw new Error(
      "Production database detected. Rerun with --confirm-production only if this is the intended database.",
    );
  }

  const { ADMIN_CREDENTIALS, hashPassword } = await import("../utils/auth");
  if (email === ADMIN_CREDENTIALS.email) {
    throw new Error(
      "That email is reserved for the configured environment-admin login; the existing login was not changed.",
    );
  }

  const password = await readHidden("New admin password: ");
  if (password.length < 12) {
    throw new Error("Use an admin password with at least 12 characters.");
  }
  const confirmation = await readHidden("Confirm admin password: ");
  if (password !== confirmation) {
    throw new Error("The passwords did not match.");
  }

  const { default: prisma } = await import("../config/prisma");
  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new Error(
        "An account with that email already exists; no account was changed.",
      );
    }

    const name = email
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

    await prisma.user.create({
      data: {
        name,
        email,
        password: await hashPassword(password),
        role: "ADMIN",
      },
    });

    console.log(`Admin account created for ${email}.`);
    console.log("Sign in through the existing login page.");
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Admin account setup failed.",
  );
  process.exitCode = 1;
});

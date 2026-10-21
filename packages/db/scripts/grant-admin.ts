// Creates (or upgrades) a Kicko staff account for the super-admin console at /admin.
// The account needs no agency workspace. The email must also be in SUPER_ADMIN_EMAILS.
//   npm run admin:grant -- you@kicko.in
import { randomBytes } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { prisma } from '../src/index';

// Piped input (scripts, CI): all lines, read once, answered in order.
let piped: Promise<string[]> | null = null;
function pipedLines() {
  piped ??= new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d)).on('end', () => resolve(buf.split(/\r?\n/)));
  });
  return piped;
}

/** Read a line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      void pipedLines().then((lines) => {
        process.stdout.write('\n');
        resolve(lines.shift() ?? '');
      });
      return;
    }
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') process.exit(130); // Ctrl+C
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run admin:grant -- <email>');
  process.exit(1);
}

let user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  const password = await askHidden(`New account for ${email}. Choose a password (12+ characters): `);
  if (password.length < 12) {
    console.error('Use at least 12 characters for an admin password.');
    process.exit(1);
  }
  if ((await askHidden('Type it again: ')) !== password) {
    console.error('Passwords did not match.');
    process.exit(1);
  }
  const id = randomBytes(16).toString('hex');
  user = await prisma.user.create({
    data: {
      id,
      email,
      name: 'Kicko Admin',
      emailVerified: true,
      accounts: { create: { id: randomBytes(16).toString('hex'), accountId: id, providerId: 'credential', password: await hashPassword(password) } },
    },
  });
  console.log(`Created ${email}.`);
} else {
  await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  console.log(`${email} already exists; marked verified.`);
}

const listed = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).includes(email);
console.log(listed ? 'It can now sign in at /login and open /admin.' : 'Add it to SUPER_ADMIN_EMAILS in .env to open /admin.');
await prisma.$disconnect();

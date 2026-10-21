// Marks a Kicko staff account as verified so it can open /admin.
// The email must also be listed in SUPER_ADMIN_EMAILS.
//   npm run admin:grant -- you@kicko.in
import { prisma } from '../src/index';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run admin:grant -- <email>');
  process.exit(1);
}
const user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  console.error(`No account for ${email}. Sign up at /signup first, then run this again.`);
  process.exit(1);
}
await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
const listed = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).includes(email);
console.log(`${email} is verified.${listed ? ' It can open /admin.' : ' Add it to SUPER_ADMIN_EMAILS in .env to open /admin.'}`);
await prisma.$disconnect();

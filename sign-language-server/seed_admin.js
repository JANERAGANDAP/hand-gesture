require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const adminEmail = process.env.ADMIN_EMAIL;
const adminPass = process.env.ADMIN_PASSWORD;
const teacherEmail = process.env.TEACHER_EMAIL;
const teacherPass = process.env.TEACHER_PASSWORD;
const missingEnv = [
  ['ADMIN_EMAIL', adminEmail],
  ['ADMIN_PASSWORD', adminPass],
  ['TEACHER_EMAIL', teacherEmail],
  ['TEACHER_PASSWORD', teacherPass],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}

async function main() {
  const hashedPassword = await bcrypt.hash(adminPass, 10);

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'ADMIN',
      password: hashedPassword,
      name: 'FSL Administrator',
    },
    create: {
      email: adminEmail,
      name: 'FSL Administrator',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  console.log('✅ Admin Account Created / Updated:');
  console.log('Email:', user.email);
  console.log('Role:', user.role);

  // Create teacher invites for both seeded accounts.
  await prisma.teacherInvite.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, invitedBy: 'system' },
  });

  // Also seed teacher account
  const hashedTeacherPass = await bcrypt.hash(teacherPass, 10);
  const teacher = await prisma.user.upsert({
    where: { email: teacherEmail },
    update: {
      role: 'TEACHER',
      password: hashedTeacherPass,
      name: 'FSL Teacher',
    },
    create: {
      email: teacherEmail,
      name: 'FSL Teacher',
      password: hashedTeacherPass,
      role: 'TEACHER',
    },
  });

  console.log('\n✅ Teacher Account Created / Updated:');
  console.log('Email:', teacher.email);
  console.log('Role:', teacher.role);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

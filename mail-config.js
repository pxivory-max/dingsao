// Keep mailbox credentials outside the repository.
const password = process.env.MAIL_PASSWORD;
if (!password || !password.trim()) {
  throw new Error('Set MAIL_PASSWORD before running mailbox helper scripts.');
}
module.exports = { password };

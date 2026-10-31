const fs = require('fs');
const path = require('path');

function getBlacklistPath(guildId) {
  return path.join(process.cwd(), 'database', 'blacklist', guildId);
}

function loadBlacklistSalonFile(blacklistPath) {
  const file = path.join(blacklistPath, 'salon.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify({ logs: { blacklist: null } }, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sendBlacklistLog(guild, embed) {
  const blacklistPath = getBlacklistPath(guild.id);
  if (!fs.existsSync(blacklistPath)) return;

  const salon = loadBlacklistSalonFile(blacklistPath);
  const channelId = salon.logs?.blacklist;
  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId);
  if (channel) channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = {
  getBlacklistPath,
  loadBlacklistSalonFile,
  sendBlacklistLog
};
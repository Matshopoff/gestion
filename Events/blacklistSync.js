const { EmbedBuilder } = require('discord.js');
const db = require('../Events/loadDatabase');
const { sendBlacklistLog } = require('../Events/blacklistLogs');

module.exports = async bot => {

  db.all('SELECT * FROM blacklist', async (err, rows) => {
    if (!rows) return;

    for (const guild of bot.guilds.cache.values()) {
      for (const bl of rows) {
        try {
          const member = await guild.members.fetch(bl.userId).catch(() => null);
          if (!member) continue;

          await member.ban({ reason: `Blacklist sync : ${bl.reason}` });

          const embed = new EmbedBuilder()
            .setTitle('🔄 Blacklist Sync')
            .setColor('Red')
            .setDescription(`👤 <@${bl.userId}>`)
            .setTimestamp();

          sendBlacklistLog(guild, embed);
        } catch {}
      }
    }
  });
};
const { EmbedBuilder } = require('discord.js');
const db = require('../Events/loadDatabase');
const { sendBlacklistLog } = require('../Events/blacklistLogs');

module.exports = async (bot, member) => {
  db.get('SELECT * FROM blacklist WHERE userId = ?', [member.id], async (err, row) => {
    if (!row) return;

    await member.ban({ reason: `Blacklist : ${row.reason}` }).catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle('⛔ Blacklist join')
      .setColor('DarkRed')
      .setDescription(`👤 <@${member.id}>`)
      .setTimestamp();

    sendBlacklistLog(member.guild, embed);
  });
};
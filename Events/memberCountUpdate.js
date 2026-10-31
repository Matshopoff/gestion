const db = require('./loadDatabase');

module.exports = async (bot) => {
  bot.on('guildMemberAdd', async (member) => updateCounter(member.guild));
  bot.on('guildMemberRemove', async (member) => updateCounter(member.guild));
};

async function updateCounter(guild) {
  db.get('SELECT channel, type FROM counter WHERE guild = ?', [guild.id], async (err, row) => {
    if (err || !row) return;
    const channel = guild.channels.cache.get(row.channel);
    if (!channel) return;
    try {
      await channel.setName(`📊・Membres : ${guild.memberCount}`);
    } catch {}
  });
}
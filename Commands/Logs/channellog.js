const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../Events/loadDatabase');
const config = require('../../config.json');

exports.help = {
  name: 'channellog',
  help: 'channellog [off]',
  helpname: 'channellog [off]',
  description: 'Active/désactive les logs des salons',
};

exports.run = async (client, message, args) => {

  const action = args[0]?.toLowerCase();

  if (action === 'off') {
    let channelsObj = {};
    try {
      channelsObj = JSON.parse(
        await new Promise(res =>
          db.get(
            'SELECT channels FROM logs WHERE guild = ?',
            [message.guild.id],
            (err, row) => res(row?.channels || '{}')
          )
        )
      );
    } catch {}

    const channelId = channelsObj["📁・channel-logs"];
    if (channelId) {
      const channel = message.guild.channels.cache.get(channelId);
      if (channel) await channel.delete().catch(() => {});
      delete channelsObj["📁・channel-logs"];
      db.run(
        `INSERT OR REPLACE INTO logs (guild, channels) VALUES (?, ?)`,
        [message.guild.id, JSON.stringify(channelsObj)]
      );
      return message.reply("Les logs des salons sont désactivés.");
    } else {
      return message.reply("Aucun logs de salon configuré.");
    }
  }

  let logsCategory = message.guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'logs'
  );

  if (!logsCategory) {
    logsCategory = await message.guild.channels.create({
      name: 'Logs',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: message.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: message.guild.ownerId, allow: [PermissionFlagsBits.ViewChannel] },
      ],
    });
  }

  const finalChannel = await message.guild.channels.create({
    name: '📁・channel-logs',
    type: ChannelType.GuildText,
    parent: logsCategory.id,
    permissionOverwrites: [
      { id: message.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: message.guild.ownerId, allow: [PermissionFlagsBits.ViewChannel] },
    ],
  });

  let channelsObj = {};
  try {
    channelsObj = JSON.parse(
      await new Promise(res =>
        db.get(
          'SELECT channels FROM logs WHERE guild = ?',
          [message.guild.id],
          (err, row) => res(row?.channels || '{}')
        )
      )
    );
  } catch {}

  channelsObj["📁・channel-logs"] = finalChannel.id;

  db.run(
    `INSERT OR REPLACE INTO logs (guild, channels) VALUES (?, ?)`,
    [message.guild.id, JSON.stringify(channelsObj)]
  );

  return message.reply(`<#${finalChannel.id}>`);
};
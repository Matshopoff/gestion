const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

exports.help = {
  name: 'memberlog',
  helpname: 'memberlog <on/off>',
  description: 'Active ou désactive les logs des membres'
};

exports.run = async (bot, message, args) => {
  const guild = message.guild;

  const basePath = path.join(process.cwd(), 'database', 'backups', guild.id);
  if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

  const salonFile = path.join(basePath, 'salon.json');
  if (!fs.existsSync(salonFile)) {
    fs.writeFileSync(salonFile, JSON.stringify({ logs: {} }, null, 2));
  }

  const salonData = JSON.parse(fs.readFileSync(salonFile, 'utf8'));
  const action = args[0]?.toLowerCase();

  if (!['on', 'off'].includes(action)) {
    return message.reply('❌ Utilisation : `memberlog on` ou `memberlog off`');
  }

  if (action === 'off') {
    salonData.logs.member = null;
    fs.writeFileSync(salonFile, JSON.stringify(salonData, null, 2));
    return message.reply('❌ Logs des membres désactivés.');
  }

  let category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'logs'
  );

  if (!category) {
    category = await guild.channels.create({
      name: 'Logs',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: guild.ownerId, allow: [PermissionFlagsBits.ViewChannel] }
      ]
    });
  }

  let logChannel = guild.channels.cache.find(
    c => c.parentId === category.id && c.name === '📁・member-logs'
  );

  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: '📁・member-logs',
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: category.permissionOverwrites.cache
    });
  }

  salonData.logs.member = logChannel.id;
  fs.writeFileSync(salonFile, JSON.stringify(salonData, null, 2));

  const embed = new EmbedBuilder()
    .setTitle('👥 Member Logs activés')
    .setColor('Green')
    .setDescription(`Les logs membres seront envoyés dans <#${logChannel.id}>`)
    .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) });

  message.reply({ embeds: [embed] });
};
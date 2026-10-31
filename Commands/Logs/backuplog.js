const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');

/* =========================
   COMMAND INFO
========================= */
exports.help = {
  name: 'backuplog',
  helpname: 'backuplog <on/off>',
  description: 'Active ou désactive les logs de backup'
};

/* =========================
   COMMAND RUN
========================= */
exports.run = async (bot, message, args) => {

  const guild = message.guild;

  /* =========================
     CRÉATION FORCÉE DOSSIERS
  ========================= */
  const backupPath = path.join(process.cwd(), 'database', 'backups', guild.id);
  if (!fs.existsSync(backupPath)) {
    fs.mkdirSync(backupPath, { recursive: true });
  }

  const salonFile = path.join(backupPath, 'salon.json');
  if (!fs.existsSync(salonFile)) {
    fs.writeFileSync(
      salonFile,
      JSON.stringify({ logs: { backup: null } }, null, 2)
    );
  }

  let salonData = JSON.parse(fs.readFileSync(salonFile, 'utf8'));

  const action = args[0]?.toLowerCase();
  if (!action || !['on', 'off'].includes(action)) {
    return message.reply('❌ Utilisation : `backuplog on` ou `backuplog off`');
  }

  /* =========================
     BACKUPLOG OFF
  ========================= */
  if (action === 'off') {
    salonData.logs.backup = null;
    fs.writeFileSync(salonFile, JSON.stringify(salonData, null, 2));

    return message.reply('❌ Logs de backup désactivés.');
  }

  /* =========================
     BACKUPLOG ON (AUTO)
  ========================= */

  // 📁 catégorie Logs
  let logsCategory = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'logs'
  );

  if (!logsCategory) {
    logsCategory = await guild.channels.create({
      name: 'Logs',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: guild.ownerId,
          allow: [PermissionFlagsBits.ViewChannel]
        }
      ]
    });
  }

  // 📁 salon backup logs
  let logChannel = guild.channels.cache.find(
    c => c.parentId === logsCategory.id && c.name === '📁・backup-logs'
  );

  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: '📁・backup-logs',
      type: ChannelType.GuildText,
      parent: logsCategory.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: guild.ownerId,
          allow: [PermissionFlagsBits.ViewChannel]
        }
      ]
    });
  }

  // 💾 sauvegarde dans salon.json
  salonData.logs.backup = logChannel.id;
  fs.writeFileSync(salonFile, JSON.stringify(salonData, null, 2));

  const embed = new EmbedBuilder()
    .setTitle('📦 Backup Logs activés')
    .setColor('Green')
    .setDescription(`Les logs de backup seront envoyés dans <#${logChannel.id}>`)
    .setFooter({text: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true })
});

  return message.reply({ embeds: [embed] });
};
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const config = require('../../config.json');
const db = require('../../Events/loadDatabase');
const Discord = require('discord.js');

exports.help = {
  name: 'sync',
  helpname: 'sync',
  description: "Synchronise les salons textuels avec leur catégorie parente",
  help: 'sync <channelID/all>',
};

exports.run = async (bot, message, args, config) => {

  // --- Vérification des permissions (identique à ping.js) ---
  const checkPerm = async (message, commandName) => {
    if (config.owners.includes(message.author.id)) return true;

    const publicStatut = await new Promise((resolve, reject) => {
      db.get('SELECT statut FROM public WHERE guild = ? AND statut = ?', [message.guild.id, 'on'], (err, row) => {
        if (err) reject(err);
        resolve(!!row);
      });
    });

    if (publicStatut) {
      const checkPublicCmd = await new Promise((resolve, reject) => {
        db.get('SELECT command FROM cmdperm WHERE perm = ? AND command = ? AND guild = ?', ['public', commandName, message.guild.id], (err, row) => {
          if (err) reject(err);
          resolve(!!row);
        });
      });
      if (checkPublicCmd) return true;
    }

    try {
      const checkUserWl = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM whitelist WHERE id = ?', [message.author.id], (err, row) => {
          if (err) reject(err);
          resolve(!!row);
        });
      });
      if (checkUserWl) return true;

      const checkDbOwner = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM owner WHERE id = ?', [message.author.id], (err, row) => {
          if (err) reject(err);
          resolve(!!row);
        });
      });
      if (checkDbOwner) return true;

      const roles = message.member.roles.cache.map(role => role.id);

      const permissions = await new Promise((resolve, reject) => {
        db.all('SELECT perm FROM permissions WHERE id IN (' + roles.map(() => '?').join(',') + ') AND guild = ?', [...roles, message.guild.id], (err, rows) => {
          if (err) reject(err);
          resolve(rows.map(row => row.perm));
        });
      });

      if (permissions.length === 0) return false;

      const checkCmdPermLevel = await new Promise((resolve, reject) => {
        db.all('SELECT command FROM cmdperm WHERE perm IN (' + permissions.map(() => '?').join(',') + ') AND guild = ?', [...permissions, message.guild.id], (err, rows) => {
          if (err) reject(err);
          resolve(rows.map(row => row.command));
        });
      });

      return checkCmdPermLevel.includes(commandName);
    } catch (error) {
      console.error('Erreur lors de la vérification des permissions:', error);
      return false;
    }
  };

  // --- Vérif accès ---
  if (!(await checkPerm(message, exports.help.name))) {
    const noacces = new EmbedBuilder()
      .setDescription("❌ Vous n'avez pas la permission d'utiliser cette commande")
      .setColor(config.color)
    .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});
    return message.reply({ embeds: [noacces], allowedMentions: { repliedUser: true } }).then(m => setTimeout(() => m.delete().catch(() => {}), 2000));
  }

  // --- Vérif perms bot ---
  if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    return message.reply("❌ Je n'ai pas la permission `MANAGE_CHANNELS` pour synchroniser les salons !");
  }

  const input = args[0];
  if (!input) {
    return message.reply('⚙️ Utilisation : `+sync all` ou `+sync <channelID ou #salon>`');
  }

  let synced = 0;

  // --- Synchroniser tous les salons ---
  if (input.toLowerCase() === 'all') {
    const textChannels = message.guild.channels.cache.filter(c => c.isTextBased() && c.parent);
    for (const channel of textChannels.values()) {
      try {
        await channel.lockPermissions(); // synchronise avec la catégorie
        synced++;
      } catch (err) {
        console.error(`Erreur sync sur ${channel.name}`, err);
      }
    }

    const embed = new EmbedBuilder()
      .setDescription(`✅ Permissions synchronisées avec la catégorie pour **${synced}** salons.`)
      .setColor(config.color)
    .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});
    return message.channel.send({ embeds: [embed] });
  }

  // --- Synchroniser un salon spécifique ---
  else {
    const channel =
      message.mentions.channels.first() ||
      message.guild.channels.cache.get(input);

    if (!channel)
      return message.reply('❌ Salon introuvable.');

    if (!channel.parent)
      return message.reply('⚠️ Ce salon n’a pas de catégorie parente à synchroniser.');

    try {
      await channel.lockPermissions();
      const embed = new EmbedBuilder()
        .setDescription(`✅ Permissions synchronisées pour ${channel} avec sa catégorie.`)
        .setColor(config.color)
      .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});
      return message.channel.send({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return message.reply('❌ Impossible de synchroniser ce salon.');
    }
  }
};
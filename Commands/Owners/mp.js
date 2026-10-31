const { EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const db = require('../../Events/loadDatabase');
const Discord = require('discord.js');

exports.help = {
  name: 'mp',
  helpname: 'mp',
  description: "Envoie un message privé à un membre spécifique (owner uniquement)",
  help: 'mp @utilisateur | message',
};

exports.run = async (bot, message, args, config) => {

  // --- Système de permission identique à ping.js ---
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

  // --- Analyse de la commande ---
  const fullText = args.join(' ');
  const [mentionPart, msgPart] = fullText.split('|').map(t => t?.trim());

  if (!mentionPart || !msgPart) {
    return message.reply({
      content: "⚙️ Utilisation : `+mp @utilisateur | message`",
    });
  }

  const member = message.mentions.members.first() || message.guild.members.cache.get(mentionPart);

  if (!member) {
    return message.reply("❌ Utilisateur introuvable !");
  }

  if (member.user.bot) {
    return message.reply("⚠️ Vous ne pouvez pas envoyer un MP à un bot !");
  }

  try {
    await member.send(msgPart);
    const done = new EmbedBuilder()
      .setDescription(`✅ Message envoyé en privé à **${member.user.tag}**.`)
      .setColor(config.color)
    .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});
    return message.channel.send({ embeds: [done] });
  } catch (err) {
    const fail = new EmbedBuilder()
      .setDescription(`❌ Impossible d'envoyer un message à **${member.user.tag}** (MP fermés).`)
      .setColor(config.color)
    .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});
    return message.channel.send({ embeds: [fail] });
  }
};
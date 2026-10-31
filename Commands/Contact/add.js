const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../Events/loadDatabase');
const config = require('../../config.json');
const sendLog = require('../../Events/sendlog');

exports.help = {
  name: 'add',
  helpname: 'add <mention/id>',
  description: "Permet d'ajouter une personne au ticket",
  help: 'add <mention/id>',
};

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

exports.run = async (bot, message, args, commandConfig) => {
  const cfg = commandConfig || config;

  if (!message.guild || !message.member) return;

  const checkPerm = async (commandName) => {
    if (cfg.owners?.includes(message.author.id)) return true;

    try {
      const publicStatus = await dbGet(
        'SELECT statut FROM public WHERE guild = ? AND statut = ?',
        [message.guild.id, 'on']
      );

      if (publicStatus) {
        const publicCommand = await dbGet(
          'SELECT command FROM cmdperm WHERE perm = ? AND command = ? AND guild = ?',
          ['public', commandName, message.guild.id]
        );

        if (publicCommand) return true;
      }

      const whitelist = await dbGet(
        'SELECT id FROM whitelist WHERE id = ?',
        [message.author.id]
      );

      if (whitelist) return true;

      const owner = await dbGet(
        'SELECT id FROM owner WHERE id = ?',
        [message.author.id]
      );

      if (owner) return true;

      const roles = message.member.roles.cache.map(role => role.id);
      if (!roles.length) return false;

      const permissions = await dbAll(
        `SELECT perm FROM permissions
         WHERE id IN (${roles.map(() => '?').join(',')})
         AND guild = ?`,
        [...roles, message.guild.id]
      );

      const perms = permissions.map(row => row.perm);
      if (!perms.length) return false;

      const commands = await dbAll(
        `SELECT command FROM cmdperm
         WHERE perm IN (${perms.map(() => '?').join(',')})
         AND guild = ?`,
        [...perms, message.guild.id]
      );

      return commands.some(row => row.command === commandName);
    } catch (error) {
      console.error('[ADD] Erreur permissions :', error);
      return false;
    }
  };

  if (!(await checkPerm(exports.help.name))) {
    const embed = new EmbedBuilder()
      .setDescription("Vous n'avez pas la permission d'utiliser cette commande.")
      .setColor(cfg.color)
      .setFooter({
        text: message.guild.name,
        iconURL: message.guild.iconURL() || undefined,
      });

    return message.reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false },
    });
  }

  const userArg = args[0];

  if (!userArg) {
    return message.reply('Utilisation : `add <mention/id>`');
  }

  const user =
    message.mentions.users.first() ||
    await bot.users.fetch(userArg).catch(() => null);

  if (!user) {
    return message.reply("❌ Je n'ai pas trouvé cet utilisateur.");
  }

  if (user.bot) {
    return message.reply("❌ Tu ne peux pas ajouter un bot à ce ticket avec cette commande.");
  }

  const channel = message.channel;

  // Vérifie la présence du ticket dans la nouvelle table.
  let ticket = null;

  try {
    const columns = await dbAll('PRAGMA table_info(tickets)');

    const channelColumn = ['channel_id', 'channelId'].find(
      name => columns.some(column => column.name === name)
    );

    if (channelColumn) {
      ticket = await dbGet(
        `SELECT * FROM tickets WHERE ${channelColumn} = ?`,
        [channel.id]
      );
    }
  } catch (error) {
    console.log('[ADD] Table tickets non disponible, vérification ancienne table.');
  }

  // Compatibilité avec l'ancienne table.
  if (!ticket) {
    try {
      ticket = await dbGet(
        'SELECT channelId FROM ticketchannel WHERE channelId = ?',
        [channel.id]
      );
    } catch (error) {
      console.error('[ADD] Erreur recherche ticket :', error);
    }
  }

  if (!ticket) {
    return message.reply(
      "❌ Cette commande peut uniquement être utilisée dans un ticket enregistré."
    );
  }

  const botMember = message.guild.members.me;

  if (
    !botMember ||
    !botMember.permissionsIn(channel).has(
      PermissionsBitField.Flags.ManageChannels
    )
  ) {
    return message.reply(
      "❌ Je n'ai pas la permission **Gérer les salons**."
    );
  }

  try {
    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });

    await message.reply(`${user} a été ajouté au ticket.`);

    const embed = new EmbedBuilder()
      .setColor(cfg.color)
      .setDescription(
        `<@${message.author.id}> a ajouté <@${user.id}> au salon ${channel}.`
      )
      .setTimestamp();

    await sendLog(message.guild, embed, 'ticketlog');
  } catch (error) {
    console.error('[ADD] Erreur ajout utilisateur :', error);

    return message.reply(
      "❌ Impossible d'ajouter cet utilisateur au ticket. Vérifie les permissions du bot."
    );
  }
};

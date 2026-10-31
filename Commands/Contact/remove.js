const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../Events/loadDatabase');
const config = require('../../config.json');
const sendLog = require('../../Events/sendlog');

exports.help = {
  name: 'remove',
  helpname: 'remove <mention/id>',
  description: 'Permet de retirer une personne du ticket',
  help: 'remove <mention/id>',
};

exports.run = async (bot, message, args, config) => {
  const checkPerm = async (message, commandName) => {
    if (config.owners.includes(message.author.id)) {
      return true;
    }

    try {
      const publicStatut = await new Promise((resolve, reject) => {
        db.get(
          'SELECT statut FROM public WHERE guild = ? AND statut = ?',
          [message.guild.id, 'on'],
          (err, row) => {
            if (err) return reject(err);
            resolve(!!row);
          }
        );
      });

      if (publicStatut) {
        const checkPublicCmd = await new Promise((resolve, reject) => {
          db.get(
            'SELECT command FROM cmdperm WHERE perm = ? AND command = ? AND guild = ?',
            ['public', commandName, message.guild.id],
            (err, row) => {
              if (err) return reject(err);
              resolve(!!row);
            }
          );
        });

        if (checkPublicCmd) return true;
      }

      const checkUserWl = await new Promise((resolve, reject) => {
        db.get(
          'SELECT id FROM whitelist WHERE id = ?',
          [message.author.id],
          (err, row) => {
            if (err) return reject(err);
            resolve(!!row);
          }
        );
      });

      if (checkUserWl) return true;

      const checkDbOwner = await new Promise((resolve, reject) => {
        db.get(
          'SELECT id FROM owner WHERE id = ?',
          [message.author.id],
          (err, row) => {
            if (err) return reject(err);
            resolve(!!row);
          }
        );
      });

      if (checkDbOwner) return true;

      const roles = message.member.roles.cache.map(role => role.id);

      if (roles.length === 0) return false;

      const permissions = await new Promise((resolve, reject) => {
        db.all(
          `SELECT perm FROM permissions
           WHERE id IN (${roles.map(() => '?').join(',')})
           AND guild = ?`,
          [...roles, message.guild.id],
          (err, rows) => {
            if (err) return reject(err);
            resolve(rows.map(row => row.perm));
          }
        );
      });

      if (permissions.length === 0) return false;

      const checkCmdPermLevel = await new Promise((resolve, reject) => {
        db.all(
          `SELECT command FROM cmdperm
           WHERE perm IN (${permissions.map(() => '?').join(',')})
           AND guild = ?`,
          [...permissions, message.guild.id],
          (err, rows) => {
            if (err) return reject(err);
            resolve(rows.map(row => row.command));
          }
        );
      });

      return checkCmdPermLevel.includes(commandName);
    } catch (error) {
      console.error('Erreur lors de la vérification des permissions :', error);
      return false;
    }
  };

  if (!message.guild || !message.member) return;

  if (!(await checkPerm(message, exports.help.name))) {
    const noacces = new EmbedBuilder()
      .setDescription("Vous n'avez pas la permission d'utiliser cette commande.")
      .setColor(config.color)
      .setFooter({
        text: message.guild.name,
        iconURL: message.guild.iconURL({ dynamic: true }) || undefined,
      });

    return message.reply({
      embeds: [noacces],
      allowedMentions: { repliedUser: true },
    }).then(m => setTimeout(() => m.delete().catch(() => {}), 2000));
  }

  const userArg = args[0];

  if (!userArg) {
    return message.reply('Utilisation : `remove <mention/id>`');
  }

  const user =
    message.mentions.users.first() ||
    await bot.users.fetch(userArg).catch(() => null);

  if (!user) {
    return message.reply("Je n'ai pas trouvé cet utilisateur.");
  }

  const channel = message.channel;

  // Vérifie que le salon correspond à un ticket enregistré.
  const ticket = await new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM tickets WHERE channel_id = ? OR channelId = ?',
      [channel.id, channel.id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  }).catch(error => {
    console.error('Erreur lors de la vérification du ticket :', error);
    return null;
  });

  // Compatibilité avec l'ancienne table ticketchannel.
  let oldTicket = null;

  if (!ticket) {
    oldTicket = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM ticketchannel WHERE channelId = ?',
        [channel.id],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    }).catch(error => {
      console.error('Erreur lors de la vérification de l’ancien ticket :', error);
      return null;
    });
  }

  if (!ticket && !oldTicket) {
    return message.reply("Cette commande peut uniquement être utilisée dans un ticket enregistré.");
  }

  if (user.id === message.author.id) {
    return message.reply("Tu ne peux pas te retirer toi-même du ticket avec cette commande.");
  }

  if (user.id === bot.user.id) {
    return message.reply("Je ne peux pas me retirer du ticket.");
  }

  if (!channel.permissionsFor(user.id)?.has(PermissionsBitField.Flags.ViewChannel)) {
    return message.reply("Cet utilisateur n'a pas accès à ce ticket.");
  }

  try {
    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: false,
    });

    await message.reply(`${user} a été retiré du ticket.`);

    const embed = new EmbedBuilder()
      .setColor(config.color)
      .setDescription(
        `<@${message.author.id}> a retiré <@${user.id}> du salon ${channel}.`
      )
      .setTimestamp();

    await sendLog(message.guild, embed, 'ticketlog');
  } catch (error) {
    console.error('Erreur lors du retrait de l’utilisateur du ticket :', error);

    return message.reply(
      "Impossible de retirer cet utilisateur. Vérifie que le bot possède la permission **Gérer les salons**."
    );
  }
};


const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../Events/loadDatabase');
const config = require('../../config.json');
const sendLog = require('../../Events/sendlog');
const discordTranscripts = require('discord-html-transcripts');

const LOG_CHANNEL_NAME = '📁・ticket-logs';

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, err => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function findTicket(channelId) {
  // Détecte la colonne réellement présente dans la table tickets.
  try {
    const columns = await new Promise((resolve, reject) => {
      db.all('PRAGMA table_info(tickets)', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    const channelColumn = ['channel_id', 'channelId']
      .find(name => columns.some(column => column.name === name));

    if (channelColumn) {
      const row = await dbGet(
        `SELECT * FROM tickets WHERE ${channelColumn} = ?`,
        [channelId]
      );

      if (row) return { table: 'tickets', column: channelColumn };
    }
  } catch (error) {
    console.error('Recherche dans tickets :', error.message);
  }

  // Compatibilité avec l'ancienne table.
  try {
    const row = await dbGet(
      'SELECT channelId FROM ticketchannel WHERE channelId = ?',
      [channelId]
    );

    if (row) return { table: 'ticketchannel', column: 'channelId' };
  } catch (error) {
    console.error('Recherche dans ticketchannel :', error.message);
  }

  return null;
}

async function closeTicket(channel, guild, user) {
  const botMember = guild.members.me;

  if (!botMember?.permissionsIn(channel).has(PermissionsBitField.Flags.ManageChannels)) {
    throw new Error("Le bot n'a pas la permission Gérer les salons.");
  }

  // Le salon de logs est obligatoire.
  const logChannel = guild.channels.cache.find(
    ch => ch.name === LOG_CHANNEL_NAME && ch.isTextBased()
  );

  if (!logChannel) {
    throw new Error(`Le salon ${LOG_CHANNEL_NAME} est introuvable.`);
  }

  // Vérifie que le salon est bien un ticket enregistré.
  const ticket = await findTicket(channel.id);

  if (!ticket) {
    throw new Error("Ce salon ne correspond pas à un ticket enregistré.");
  }

  // Génère le transcript avant toute suppression.
  const transcript = await discordTranscripts.createTranscript(channel, {
    limit: -1,
    filename: `transcript-${channel.id}.html`,
    saveImages: true,
    poweredBy: false,
  });

  const logEmbed = new EmbedBuilder()
    .setColor(config.color || 0x2b2d31)
    .setTitle('Ticket fermé')
    .setDescription(
      `**Salon :** ${channel.name}\n` +
      `**ID du salon :** ${channel.id}\n` +
      `**Fermé par :** <@${user.id}>`
    )
    .setTimestamp()
    .setFooter({
      text: guild.name,
      iconURL: guild.iconURL() || undefined,
    });

  // Si cet envoi échoue, aucune suppression n'est exécutée.
  await logChannel.send({
    embeds: [logEmbed],
    files: [transcript],
    allowedMentions: { parse: [] },
  });

  // Nettoie la base uniquement après l'envoi réussi.
  await dbRun(
    `DELETE FROM ${ticket.table} WHERE ${ticket.column} = ?`,
    [channel.id]
  );

  // Dernière étape : supprimer le salon.
  await channel.delete(`Ticket fermé par ${user.tag || user.id}`);

  return true;
}

exports.help = {
  name: 'close',
  helpname: 'close',
  description: 'Permet de fermer un ticket',
  help: 'close',
};

exports.run = async (bot, message, args, commandConfig) => {
  if (!message.guild || !message.member) return;

  const cfg = commandConfig || config;

  async function checkPerm(commandName) {
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

      const permissions = await new Promise((resolve, reject) => {
        db.all(
          `SELECT perm FROM permissions
           WHERE id IN (${roles.map(() => '?').join(',')})
           AND guild = ?`,
          [...roles, message.guild.id],
          (err, rows) => {
            if (err) return reject(err);
            resolve((rows || []).map(row => row.perm));
          }
        );
      });

      if (!permissions.length) return false;

      const commands = await new Promise((resolve, reject) => {
        db.all(
          `SELECT command FROM cmdperm
           WHERE perm IN (${permissions.map(() => '?').join(',')})
           AND guild = ?`,
          [...permissions, message.guild.id],
          (err, rows) => {
            if (err) return reject(err);
            resolve((rows || []).map(row => row.command));
          }
        );
      });

      return commands.includes(commandName);
    } catch (error) {
      console.error('Erreur de permissions close :', error);
      return false;
    }
  }

  if (!(await checkPerm(exports.help.name))) {
    const embed = new EmbedBuilder()
      .setDescription("Vous n'avez pas la permission d'utiliser cette commande.")
      .setColor(cfg.color || 0x2b2d31);

    return message.reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false },
    });
  }

  try {
    await closeTicket(message.channel, message.guild, message.author);
  } catch (error) {
    console.error('Erreur fermeture ticket :', error);

    return message.reply({
      content: `❌ ${error.message || "La fermeture du ticket a échoué."}`,
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
  }
};

exports.closeTicket = closeTicket;

const {
  EmbedBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');
const config = require('../../config.json');
const db = require('../../Events/loadDatabase');

exports.help = {
  name: 'counter',
  helpname: 'counter',
  description: "Crée, configure ou supprime un compteur de membres (textuel ou vocal)",
  help: 'counter <create|delete|set|info> [text|voice|#salon]',
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
        db.all(
          'SELECT perm FROM permissions WHERE id IN (' + roles.map(() => '?').join(',') + ') AND guild = ?',
          [...roles, message.guild.id],
          (err, rows) => {
            if (err) reject(err);
            resolve(rows.map(row => row.perm));
          }
        );
      });

      if (permissions.length === 0) return false;

      const checkCmdPermLevel = await new Promise((resolve, reject) => {
        db.all(
          'SELECT command FROM cmdperm WHERE perm IN (' + permissions.map(() => '?').join(',') + ') AND guild = ?',
          [...permissions, message.guild.id],
          (err, rows) => {
            if (err) reject(err);
            resolve(rows.map(row => row.command));
          }
        );
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
    return message.reply({ embeds: [noacces] });
  }

  // --- Initialisation table ---
  db.run('CREATE TABLE IF NOT EXISTS counter (guild TEXT PRIMARY KEY, channel TEXT, type TEXT)', (err) => {
    if (err) console.error(err);
  });

  const sub = args[0]?.toLowerCase();
  const type = args[1]?.toLowerCase();
  const channelMention = message.mentions.channels.first();

  if (!sub) {
    return message.reply({
      content: "⚙️ Utilisation : `+counter <create|delete|set|info>` [text|voice|#salon]",
    });
  }

  // === CREATE ===
  if (sub === 'create') {
    if (!['text', 'voice'].includes(type))
      return message.reply("⚠️ Type invalide : choisis `text` ou `voice`.");

    const count = message.guild.memberCount;

    try {
      const channel = await message.guild.channels.create({
        name: `📊・Membres : ${count}`,
        type:
          type === 'voice'
            ? ChannelType.GuildVoice
            : ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: message.guild.id,
            deny: [PermissionsBitField.Flags.SendMessages],
            allow: [PermissionsBitField.Flags.ViewChannel],
          },
        ],
      });

      db.run('INSERT OR REPLACE INTO counter (guild, channel, type) VALUES (?, ?, ?)', [
        message.guild.id,
        channel.id,
        type,
      ]);

      const embed = new EmbedBuilder()
        .setDescription(`✅ Salon compteur ${type === 'voice' ? 'vocal' : 'textuel'} créé : ${channel}`)
        .setColor(config.color)
      .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});
      return message.channel.send({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return message.reply("❌ Erreur lors de la création du salon compteur.");
    }
  }

  // === DELETE ===
  else if (sub === 'delete') {
    db.get('SELECT channel FROM counter WHERE guild = ?', [message.guild.id], async (err, row) => {
      if (err) return console.error(err);
      if (!row) return message.reply("❌ Aucun compteur configuré.");

      const channel = message.guild.channels.cache.get(row.channel);
      if (channel) await channel.delete().catch(() => {});
      db.run('DELETE FROM counter WHERE guild = ?', [message.guild.id]);

      const embed = new EmbedBuilder()
        .setDescription("🗑️ Compteur supprimé avec succès.")
        .setColor(config.color)
      .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});
      return message.channel.send({ embeds: [embed] });
    });
  }

  // === SET ===
  else if (sub === 'set') {
    if (!channelMention)
      return message.reply("⚙️ Mentionne un salon existant à définir comme compteur.");

    db.run(
      'INSERT OR REPLACE INTO counter (guild, channel, type) VALUES (?, ?, ?)',
      [message.guild.id, channelMention.id, 'text'],
    );

    const embed = new EmbedBuilder()
      .setDescription(`✅ Le salon ${channelMention} est maintenant défini comme compteur.`)
      .setColor(config.color)
    .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});
    return message.channel.send({ embeds: [embed] });
  }

  // === INFO ===
  else if (sub === 'info') {
    db.get('SELECT * FROM counter WHERE guild = ?', [message.guild.id], (err, row) => {
      if (err) return console.error(err);
      if (!row)
        return message.reply("ℹ️ Aucun compteur n’est configuré sur ce serveur.");

      const ch = message.guild.channels.cache.get(row.channel);
      const embed = new EmbedBuilder()
        .setTitle('📊 Informations du compteur')
        .addFields(
          { name: 'Salon', value: ch ? `${ch}` : `Salon introuvable (\`${row.channel}\`)`, inline: true },
          { name: 'Type', value: row.type === 'voice' ? '🔊 Vocal' : '💬 Textuel', inline: true },
        )
        .setColor(config.color)
      .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});
      return message.channel.send({ embeds: [embed] });
    });
  }

  // === Autres cas ===
  else {
    return message.reply("⚙️ Utilisation : `+counter <create|delete|set|info>` [text|voice|#salon]");
  }
};
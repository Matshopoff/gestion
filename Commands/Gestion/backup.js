const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

/* =========================
   UTILS
========================= */
function generateBackupId() {
  return 'BKP-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getBackupPath(guildId) {
  return path.join(process.cwd(), 'database', 'backups', guildId);
}

function loadSalonFile(backupPath) {
  const file = path.join(backupPath, 'salon.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ logs: { backup: null } }, null, 2));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sendBackupLog(guild, backupPath, embed) {
  const salon = loadSalonFile(backupPath);
  const logChannelId = salon.logs?.backup;
  if (!logChannelId) return;

  const channel = guild.channels.cache.get(logChannelId);
  if (channel) channel.send({ embeds: [embed] }).catch(() => {});
}

/* =========================
   COMMAND
========================= */
exports.help = {
  name: 'backup',
  helpname: 'backup <create|list|restore|delete>',
  description: 'Système complet de backup serveur'
};

exports.run = async (bot, message, args) => {

  const guild = message.guild;

  /* ===== CRÉATION FORCÉE DES DOSSIERS ===== */
  const backupPath = getBackupPath(guild.id);
  if (!fs.existsSync(backupPath)) fs.mkdirSync(backupPath, { recursive: true });
  loadSalonFile(backupPath);

  const sub = args[0];
  if (!sub) {
    return message.reply('❌ Utilisation : `backup create`, `backup list`, `backup restore <ID>`, `backup delete <ID>`');
  }

  /* =========================
     BACKUP LIST
  ========================= */
  if (sub === 'list') {
    const files = fs.readdirSync(backupPath).filter(f => f.endsWith('.json') && f !== 'salon.json');
    if (!files.length) return message.reply('❌ Aucun backup disponible');

    const list = files.map(f => {
      const d = JSON.parse(fs.readFileSync(path.join(backupPath, f)));
      return `🆔 **${d.id}** — <t:${Math.floor(d.createdAt / 1000)}:F>`;
    });

    const embed = new EmbedBuilder()
      .setTitle('📦 Backups disponibles')
      .setDescription(list.join('\n'))
      .setColor('Blue')
      .setFooter({text: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true })
});

    return message.reply({ embeds: [embed] });
  }

  /* =========================
     CONFIRMATION BOUTONS
  ========================= */
  const embedConfirm = new EmbedBuilder()
    .setColor('Orange')
    .setTitle('⚠️ Confirmation requise')
    .setDescription(sub === 'create'
      ? 'Confirmer la **création d’un backup** ?'
      : '⚠️ Cette action est **IRRÉVERSIBLE**.\nConfirme pour continuer.'
    )
    .setFooter({text: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true })
});
    
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm').setLabel('Confirmer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );

  const msg = await message.reply({ embeds: [embedConfirm], components: [row] });
  const collector = msg.createMessageComponentCollector({ time: 20000 });

  collector.on('collect', async i => {
    if (i.user.id !== message.author.id) return;

    if (i.customId === 'cancel') {
      collector.stop();
      return i.update({ content: '❌ Action annulée', embeds: [], components: [] });
    }

    /* =========================
       BACKUP CREATE
    ========================= */
    if (sub === 'create') {
      const backupId = generateBackupId();

      const backup = {
        id: backupId,
        createdAt: Date.now(),
        roles: [],
        channels: []
      };

      guild.roles.cache
        .filter(r => r.id !== guild.id)
        .sort((a, b) => a.position - b.position)
        .forEach(r => {
          backup.roles.push({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: r.permissions.bitfield.toString()
          });
        });

      guild.channels.cache
        .sort((a, b) => a.position - b.position)
        .forEach(c => {
          backup.channels.push({
            name: c.name,
            type: c.type,
            parent: c.parent?.name || null,
            permissionOverwrites: c.permissionOverwrites.cache.map(p => ({
              id: p.id,
              allow: p.allow.bitfield.toString(),
              deny: p.deny.bitfield.toString()
            }))
          });
        });

      fs.writeFileSync(
        path.join(backupPath, `${backupId}.json`),
        JSON.stringify(backup, null, 2)
      );

      const logEmbed = new EmbedBuilder()
        .setTitle('📦 Nouvelle Backup')
        .setColor('Green')
        .setDescription(`🆔 **ID :** \`${backupId}\`\n👤 **Par :** <@${message.author.id}>\n🕒 <t:${Math.floor(Date.now() / 1000)}:F>`)
        .setFooter({text: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true })
});

      sendBackupLog(guild, backupPath, logEmbed);

      collector.stop();
      return i.update({ content: `✅ Backup créée : \`${backupId}\``, embeds: [], components: [] });
    }

    /* =========================
       BACKUP DELETE
    ========================= */
    if (sub === 'delete') {
      const id = args[1];
      const file = path.join(backupPath, `${id}.json`);
      if (!id || !fs.existsSync(file)) {
        return i.update({ content: '❌ Backup introuvable', embeds: [], components: [] });
      }

      fs.unlinkSync(file);
      collector.stop();
      return i.update({ content: `🗑️ Backup \`${id}\` supprimée`, embeds: [], components: [] });
    }

    /* =========================
       BACKUP RESTORE
    ========================= */
    if (sub === 'restore') {
      const id = args[1];
      const file = path.join(backupPath, `${id}.json`);
      if (!id || !fs.existsSync(file)) {
        return i.update({ content: '❌ Backup introuvable', embeds: [], components: [] });
      }

      await i.update({ content: '⚠️ Tape **CONFIRMER** pour continuer (30s)', embeds: [], components: [] });

      try {
        await message.channel.awaitMessages({
          filter: m => m.author.id === message.author.id && m.content === 'CONFIRMER',
          max: 1,
          time: 30000
        });
      } catch {
        return message.channel.send('❌ Temps écoulé');
      }

      const backup = JSON.parse(fs.readFileSync(file));

      for (const c of guild.channels.cache.values()) await c.delete().catch(() => {});
      for (const r of guild.roles.cache.values()) if (r.id !== guild.id) await r.delete().catch(() => {});

      for (const r of backup.roles) {
        await guild.roles.create({
          name: r.name,
          color: r.color,
          hoist: r.hoist,
          mentionable: r.mentionable,
          permissions: new PermissionsBitField(BigInt(r.permissions))
        });
      }

      const cats = {};
      for (const c of backup.channels.filter(c => c.type === ChannelType.GuildCategory)) {
        const cat = await guild.channels.create({ name: c.name, type: ChannelType.GuildCategory });
        cats[c.name] = cat.id;
      }

      for (const c of backup.channels.filter(c => c.type !== ChannelType.GuildCategory)) {
        await guild.channels.create({
          name: c.name,
          type: c.type,
          parent: cats[c.parent] || null,
          permissionOverwrites: c.permissionOverwrites.map(p => ({
            id: p.id,
            allow: BigInt(p.allow),
            deny: BigInt(p.deny)
          }))
        });
      }

      const logEmbed = new EmbedBuilder()
        .setTitle('♻️ Backup Restaurée')
        .setColor('Orange')
        .setDescription(`🆔 **ID :** \`${id}\`\n👤 <@${message.author.id}>\n🕒 <t:${Math.floor(Date.now() / 1000)}:F>`)
        .setFooter({text: message.guild.name, iconURL: message.guild.iconURL({ dynamic: true })
});

      sendBackupLog(guild, backupPath, logEmbed);

      return message.channel.send(`✅ Restauration terminée : \`${id}\``);
    }
  });

  collector.on('end', () => msg.edit({ components: [] }).catch(() => {}));
};
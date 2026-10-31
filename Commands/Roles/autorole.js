const { EmbedBuilder } = require("discord.js");

const config = require("../../config.json");

const db = require("../../Events/loadDatabase");

const fs = require("fs");

const path = require("path");

const dataPath = path.join(__dirname, "../../database/autorole.json");

if (!fs.existsSync(path.dirname(dataPath))) fs.mkdirSync(path.dirname(dataPath), { recursive: true });

if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, "{}");

exports.help = {

  name: "autorole",

  helpname: "autorole",

  description: "Définit ou affiche le rôle automatique du serveur",

  help: "autorole {id/mention}",

};

exports.run = async (bot, message, args) => {

  // Vérification des permissions via ta BDD

  const checkPerm = async (message, commandName) => {

    if (config.owners.includes(message.author.id)) return true;

    const publicStatut = await new Promise((resolve, reject) => {

      db.get("SELECT statut FROM public WHERE guild = ? AND statut = ?", [message.guild.id, "on"], (err, row) => {

        if (err) reject(err);

        resolve(!!row);

      });

    });

    if (publicStatut) {

      const checkPublicCmd = await new Promise((resolve, reject) => {

        db.get(

          "SELECT command FROM cmdperm WHERE perm = ? AND command = ? AND guild = ?",

          ["public", commandName, message.guild.id],

          (err, row) => {

            if (err) reject(err);

            resolve(!!row);

          }

        );

      });

      if (checkPublicCmd) return true;

    }

    try {

      const checkUserWl = await new Promise((resolve, reject) => {

        db.get("SELECT id FROM whitelist WHERE id = ?", [message.author.id], (err, row) => {

          if (err) reject(err);

          resolve(!!row);

        });

      });

      if (checkUserWl) return true;

      const checkDbOwner = await new Promise((resolve, reject) => {

        db.get("SELECT id FROM owner WHERE id = ?", [message.author.id], (err, row) => {

          if (err) reject(err);

          resolve(!!row);

        });

      });

      if (checkDbOwner) return true;

      const roles = message.member.roles.cache.map((r) => r.id);

      const permissions = await new Promise((resolve, reject) => {

        db.all(

          "SELECT perm FROM permissions WHERE id IN (" + roles.map(() => "?").join(",") + ") AND guild = ?",

          [...roles, message.guild.id],

          (err, rows) => {

            if (err) reject(err);

            resolve(rows.map((row) => row.perm));

          }

        );

      });

      if (permissions.length === 0) return false;

      const checkCmdPermLevel = await new Promise((resolve, reject) => {

        db.all(

          "SELECT command FROM cmdperm WHERE perm IN (" + permissions.map(() => "?").join(",") + ") AND guild = ?",

          [...permissions, message.guild.id],

          (err, rows) => {

            if (err) reject(err);

            resolve(rows.map((row) => row.command));

          }

        );

      });

      return checkCmdPermLevel.includes(commandName);

    } catch (error) {

      console.error("Erreur checkPerm autorole:", error);

      return false;

    }

  };

  // Si l’utilisateur n’a pas la permission

  if (!(await checkPerm(message, exports.help.name))) {

    const noPerm = new EmbedBuilder()

      .setDescription("🚫 Vous n'avez pas la permission d'utiliser cette commande.")

      .setColor(config.color)
    .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});

    return message.reply({ embeds: [noPerm], allowedMentions: { repliedUser: true } })

      .then((m) => setTimeout(() => m.delete().catch(() => {}), 3000));

  }

  const guildId = message.guild.id;

  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  // Affichage du rôle actuel

  if (!args[0]) {

    const roleId = data[guildId];

    if (!roleId) {

      const embed = new EmbedBuilder()

        .setColor(config.color)

        .setDescription("ℹ️ Aucun rôle automatique n'est configuré pour ce serveur.");

      return message.reply({ embeds: [embed] });

    }

    const role = message.guild.roles.cache.get(roleId);

    const embed = new EmbedBuilder()

      .setColor(config.color)

      .setTitle("⚙️ Configuration de l'autorole")

      .setDescription(`Le rôle automatique actuel est : ${role ? role : `\`${roleId}\``}`)

      .setFooter({ text: "Utilisez +autorole @rôle pour le modifier" });

    return message.reply({ embeds: [embed] });

  }

  // Définition du nouveau rôle

  const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0].replace(/[<@&>]/g, ""));

  if (!role) {

    const errorEmbed = new EmbedBuilder()

      .setColor(config.color)

      .setDescription("❌ Rôle invalide ou introuvable.");

    return message.reply({ embeds: [errorEmbed] });

  }

  data[guildId] = role.id;

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));

  const success = new EmbedBuilder()

    .setColor(config.color)

    .setTitle("✅ Autorole configuré")

    .setDescription(`Le rôle **${role.name}** sera désormais attribué automatiquement aux nouveaux membres.`)

    .setFooter({
  text: `${message.guild.name}`,
  iconURL: message.guild.iconURL({ dynamic: true })
});

  return message.reply({ embeds: [success] });

};
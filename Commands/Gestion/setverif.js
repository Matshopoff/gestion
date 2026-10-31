const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const db = require('../../Events/loadDatabase'); // <-- IMPORTANT : chemin SQL correct

exports.help = {
  name: "set-verif",
  helpname: "set-verif",
  description: "Installe le système de vérification d'identité"
};

exports.run = async (client, message, args) => {

  // ===========================
  // VERIFICATION ARGUMENT
  // ===========================
  const roleId = args[0];
  if (!roleId) {
    return message.reply("❌ Merci d’indiquer l’ID du rôle : `+set-verif <id_du_role>`");
  }

  const role = message.guild.roles.cache.get(roleId);
  if (!role) {
    return message.reply("❌ Rôle introuvable. Vérifie l’ID.");
  }

  // ===========================
  // STOCKAGE SQL DU ROLE
  // ===========================
  db.run(
    "CREATE TABLE IF NOT EXISTS verifrole (guildId TEXT PRIMARY KEY, roleId TEXT)"
  );

  db.run(
    "INSERT OR REPLACE INTO verifrole (guildId, roleId) VALUES (?, ?)",
    [message.guild.id, roleId]
  );

  // ===========================
  // MESSAGE DE VERIFICATION
  // ===========================
  const serverName = message.guild.name;

  const embed = new EmbedBuilder()
    .setTitle(`Bienvenue sur ${serverName}`)
    .setDescription(
      `Bonjour et bienvenue au sein de **${serverName}**.\n` +
      `Je suis **Virginie Bonrain**, Secrétaire du **${serverName}**.\n\n` +
      `Avant de pouvoir vous orienter vers nos services et nos équipes juridiques, je me dois de procéder à une vérification de votre identité.\n\n` +
      `Cliquez sur le bouton ci-dessous pour continuer.`
    )
    .setColor('#2b2d31');

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('startVerif')
      .setLabel('Procéder à la vérification')
      .setStyle(ButtonStyle.Primary)
  );

  await message.channel.send({ embeds: [embed], components: [button] });

  // ===========================
  // CONFIRMATION
  // ===========================
  message.reply(`✅ Système de vérification installé.\nRôle configuré : <@&${roleId}>`);
};

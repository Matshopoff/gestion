const { EmbedBuilder } = require("discord.js");

const config = require("../../config.json");

const db = require("../../Events/loadDatabase");

exports.help = {

  name: "invitations",

  helpname: "invitations",

  description: "Affiche les invitations d’un utilisateur",

  help: "invitations [@user]",

};

exports.run = async (bot, message, args) => {

  const member = message.mentions.members.first() || message.member;

  try {

    const invites = await message.guild.invites.fetch();

    const userInvites = invites.filter(inv => inv.inviter && inv.inviter.id === member.id);

    const inviteCount = userInvites.reduce((acc, inv) => acc + (inv.uses || 0), 0);

    const embed = new EmbedBuilder()

      .setTitle("📨 Invitations")

      .setDescription(`**${member.user.tag}** a actuellement **${inviteCount}** invitations.`)

      .setColor(config.color)
    .setFooter({
  text: message.guild.name,
  iconURL: message.guild.iconURL({ dynamic: true })
});

    message.reply({ embeds: [embed] });

  } catch (err) {

    console.error(err);

    message.reply("❌ Impossible de récupérer les invitations.");

  }

};
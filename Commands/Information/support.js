const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const packageJson = require("../../package.json");

exports.help = {
    name: "support",
    helpname: "support",
    description: "Affiche les informations officielles du bot",
    help: "support"
};

exports.run = async (bot, message, args, config) => {
    const version = packageJson.version || "Non renseignée";

    const supportEmbed = new EmbedBuilder()
        .setColor(config.color)
        .setAuthor({
            name: "À PROPOS DU BOT",
            iconURL: bot.user.displayAvatarURL()
        })
        .setTitle("🤖 Présentation du bot")
        .setDescription(
            `**${bot.user.username}** est un bot Discord conçu pour proposer ` +
            "des fonctionnalités de gestion, de modération et d'administration " +
            "aux serveurs Discord.\n\n" +
            "━━━━━━━━━━━━━━━━━━━━\n\n" +
            "📌 **Informations générales**\n\n" +
            `> **Nom :** ${bot.user.username}\n` +
            `> **Identifiant :** \`${bot.user.id}\`\n` +
            `> **Serveur actuel :** ${message.guild.name}\n\n` +
            "━━━━━━━━━━━━━━━━━━━━\n\n" +
            "🛠️ **Développement**\n\n" +
            "> **Développeur :** mathis.du06 (`1325614558987026494`)\n" +
            "> **Langage :** Node.js\n" +
            `> **Version :** ${version}\n\n` +
            "━━━━━━━━━━━━━━━━━━━━\n\n" +
            "🌐 **Serveur officiel**\n\n" +
            "Rejoins notre communauté pour découvrir le projet et suivre son évolution."
        )
        .setThumbnail(bot.user.displayAvatarURL({ size: 1024 }))
        .setFooter({
            text: "Informations officielles • Merci d'utiliser le bot",
            iconURL: message.guild.iconURL() || undefined
        })
        .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel("Serveur officiel")
            .setEmoji("🌐")
            .setStyle(ButtonStyle.Link)
            .setURL("https://discord.gg/2dkmYrmUwc"),

        new ButtonBuilder()
            .setLabel("Inviter le bot")
            .setEmoji("🤖")
            .setStyle(ButtonStyle.Link)
            .setURL(
                `https://discord.com/oauth2/authorize?client_id=${bot.user.id}&permissions=8&scope=bot%20applications.commands`
            )
    );

    return message.reply({
        embeds: [supportEmbed],
        components: [buttons],
        allowedMentions: {
            repliedUser: false
        }
    });
};

const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionsBitField,
    ChannelType
} = require("discord.js");

const db = require("./loadDatabase");
const fs = require("fs");
const path = require("path");
const discordTranscripts = require("discord-html-transcripts");

const ROLE_BUTTON_PREFIX = "embed_role_toggle_";
const TICKET_LOG_CHANNEL = "📁・ticket-logs";

/* =========================================================
   OUTILS SQLITE
========================================================= */

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) return reject(error);
            resolve(row || null);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) return reject(error);
            resolve(rows || []);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) return reject(error);
            resolve(this);
        });
    });
}

/* =========================================================
   TICKETS : MIGRATION ET EMBED
========================================================= */

async function ensureClaimColumn() {
    const columns = await dbAll("PRAGMA table_info(tickets)");

    if (!columns.some(column => column.name === "claimed_by")) {
        await dbRun(
            "ALTER TABLE tickets ADD COLUMN claimed_by TEXT DEFAULT NULL"
        );
    }
}

function normalizeChannelName(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 90) || "support";
}

function buildTicketEmbed({
    reason,
    description,
    userId,
    categoryName,
    staffRoleId,
    claimedBy,
    color
}) {
    return new EmbedBuilder()
        .setColor(color || "#5865F2")
        .setAuthor({
            name: "CENTRE DE SUPPORT"
        })
        .setTitle(`🎫 ${reason}`)
        .setDescription(
            "Bienvenue dans votre espace de support.\n" +
            "Merci de détailler votre demande afin que notre équipe puisse vous aider."
        )
        .addFields(
            {
                name: "👤 Demandeur",
                value: `<@${userId}>`,
                inline: true
            },
            {
                name: "📁 Catégorie",
                value: categoryName || "Support",
                inline: true
            },
            {
                name: "📌 Statut",
                value: claimedBy
                    ? "🟢 Pris en charge"
                    : "🟡 En attente du staff",
                inline: true
            },
            {
                name: "📝 Description",
                value: String(description || "Aucune description fournie.")
                    .slice(0, 1024),
                inline: false
            },
            {
                name: "🛠️ Responsable",
                value: claimedBy
                    ? `<@${claimedBy}>`
                    : "Personne pour le moment",
                inline: true
            },
            {
                name: "👥 Équipe",
                value: staffRoleId
                    ? `<@&${staffRoleId}>`
                    : "Aucun rôle configuré",
                inline: true
            }
        )
        .setFooter({
            text: "Support • Merci de rester courtois avec l'équipe"
        })
        .setTimestamp();
}

function buildTicketButtons(claimedBy = null) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ticket_claim")
            .setLabel(claimedBy ? "Ticket pris en charge" : "Claim le ticket")
            .setEmoji("🙋")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(Boolean(claimedBy)),
        new ButtonBuilder()
            .setCustomId("ticket_close")
            .setLabel("Fermer le ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger)
    );
}

/* =========================================================
   RECHERCHE DU TICKET DANS SQLITE
   Compatible avec tickets et ticketchannel
========================================================= */

async function findTicketRecord(channelId) {
    try {
        const columns = await dbAll("PRAGMA table_info(tickets)");

        const channelColumn = ["channel_id", "channelId"].find(
            name => columns.some(column => column.name === name)
        );

        if (channelColumn) {
            const ticket = await dbGet(
                `SELECT * FROM tickets WHERE ${channelColumn} = ?`,
                [channelId]
            );

            if (ticket) {
                return {
                    table: "tickets",
                    column: channelColumn
                };
            }
        }
    } catch (error) {
        console.log("[TICKET] Table tickets non disponible.");
    }

    try {
        const ticket = await dbGet(
            "SELECT channelId FROM ticketchannel WHERE channelId = ?",
            [channelId]
        );

        if (ticket) {
            return {
                table: "ticketchannel",
                column: "channelId"
            };
        }
    } catch (error) {
        console.error("[TICKET DB]", error);
    }

    return null;
}

/* =========================================================
   FERMETURE DU TICKET AVEC TRANSCRIPT HTML
========================================================= */

async function closeTicketWithTranscript(interaction) {
    const guild = interaction.guild;
    const channel = interaction.channel;
    const user = interaction.user;

    if (!guild || !channel || !channel.isTextBased()) {
        throw new Error("Cette action doit être utilisée dans un ticket.");
    }

    const botMember = guild.members.me;

    if (
        !botMember ||
        !botMember.permissionsIn(channel).has(
            PermissionsBitField.Flags.ManageChannels
        )
    ) {
        throw new Error("Je n'ai pas la permission Gérer les salons.");
    }

    const ticketRecord = await findTicketRecord(channel.id);

    if (!ticketRecord) {
        throw new Error(
            "Ce salon n'est pas enregistré comme ticket dans la base de données."
        );
    }

    let channels;

    try {
        channels = await guild.channels.fetch();
    } catch (error) {
        throw new Error(
            "Impossible de récupérer les salons. Le ticket est conservé."
        );
    }

    const logChannel = channels.find(
        ch =>
            ch &&
            ch.name === TICKET_LOG_CHANNEL &&
            ch.type === ChannelType.GuildText
    );

    if (!logChannel) {
        throw new Error(
            `Le salon ${TICKET_LOG_CHANNEL} est introuvable. Le ticket est conservé.`
        );
    }

    const logPermissions = logChannel.permissionsFor(botMember);

    if (
        !logPermissions ||
        !logPermissions.has([
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks
        ])
    ) {
        throw new Error(
            `Je n'ai pas les permissions nécessaires dans ${TICKET_LOG_CHANNEL}. Le ticket est conservé.`
        );
    }

    let transcript;

    try {
        transcript = await discordTranscripts.createTranscript(channel, {
            limit: -1,
            filename: `transcript-${channel.id}.html`,
            saveImages: true,
            poweredBy: false
        });
    } catch (error) {
        console.error("[TRANSCRIPT GENERATION]", error);
        throw new Error(
            "Impossible de générer le transcript HTML. Le ticket est conservé."
        );
    }

    const ticketData = await dbGet(
        "SELECT * FROM tickets WHERE channel_id = ?",
        [channel.id]
    ).catch(() => null);

    const logEmbed = new EmbedBuilder()
        .setColor("#ED4245")
        .setTitle("🔒 Ticket fermé")
        .setDescription(
            `**Salon :** ${channel.name}\n` +
            `**ID du salon :** \`${channel.id}\`\n` +
            `**Demandeur :** ${ticketData?.user_id ? `<@${ticketData.user_id}>` : "Inconnu"}\n` +
            `**Motif :** ${ticketData?.reason || "Non renseigné"}\n` +
            `**Fermé par :** <@${user.id}>`
        )
        .setTimestamp()
        .setFooter({
            text: guild.name,
            iconURL: guild.iconURL() || undefined
        });

    try {
        await logChannel.send({
            embeds: [logEmbed],
            files: [transcript],
            allowedMentions: {
                parse: []
            }
        });
    } catch (error) {
        console.error("[TRANSCRIPT SEND]", error);
        throw new Error(
            `L'envoi du transcript dans ${TICKET_LOG_CHANNEL} a échoué. Le ticket est conservé.`
        );
    }

    try {
        await dbRun(
            `DELETE FROM ${ticketRecord.table} WHERE ${ticketRecord.column} = ?`,
            [channel.id]
        );
    } catch (error) {
        console.error("[TICKET DELETE DB]", error);
        throw new Error(
            "Le transcript a été envoyé, mais la suppression de l'enregistrement SQLite a échoué. Le salon est conservé."
        );
    }

    try {
        await channel.delete(`Ticket fermé par ${user.tag || user.id}`);
    } catch (error) {
        console.error("[TICKET DELETE CHANNEL]", error);
        throw new Error(
            "Le transcript a été envoyé, mais Discord n'a pas permis de supprimer le salon. Vérifie les permissions du bot."
        );
    }

    return true;
}

/* =========================================================
   GESTIONNAIRE D'INTERACTIONS
========================================================= */

module.exports = {
    name: "interactionCreate",

    async execute(interaction, bot, config) {
        try {
            /* =============================================
               PARTIE 1 : CONFESSIONS
            ============================================= */

            if (
                interaction.isButton() &&
                interaction.customId === "confess_open"
            ) {
                const modal = new ModalBuilder()
                    .setCustomId("confess_modal")
                    .setTitle("Faire une confession");

                const input = new TextInputBuilder()
                    .setCustomId("confess_text")
                    .setLabel("Ta confession")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(2000);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(input)
                );

                return interaction.showModal(modal);
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId === "confess_modal"
            ) {
                if (!interaction.guild) {
                    return interaction.reply({
                        content: "Cette action fonctionne uniquement sur un serveur.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const confession =
                    interaction.fields.getTextInputValue("confess_text");

                const row = await dbGet(
                    "SELECT channel FROM Confess WHERE guildId = ?",
                    [interaction.guild.id]
                ).catch(() => null);

                if (!row || row.channel === "off") {
                    return interaction.reply({
                        content: "Le salon de confession n'est pas configuré.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const confessChannel =
                    interaction.guild.channels.cache.get(row.channel);

                if (!confessChannel) {
                    return interaction.reply({
                        content: "Le salon de confession est introuvable.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const countRow = await dbGet(
                    "SELECT COUNT(*) AS count FROM confesslogs WHERE guildId = ?",
                    [interaction.guild.id]
                ).catch(() => null);

                const confessionNumber = (countRow?.count || 0) + 1;

                db.run(
                    "INSERT INTO confesslogs (guildId, userId, message) VALUES (?, ?, ?)",
                    [
                        interaction.guild.id,
                        interaction.user.id,
                        confession
                    ],
                    error => {
                        if (error) {
                            console.error("[CONFESSION DB]", error);
                        }
                    }
                );

                const embed = new EmbedBuilder()
                    .setTitle(`Confession #${confessionNumber}`)
                    .setDescription(confession)
                    .setColor(config.color);

                const messages = await confessChannel.messages
                    .fetch({ limit: 10 })
                    .catch(() => null);

                const lastBotMsg = messages?.find(
                    message =>
                        message.author.id === interaction.client.user.id &&
                        message.components.length > 0
                );

                if (lastBotMsg) {
                    await lastBotMsg.edit({ components: [] }).catch(() => {});
                }

                const rowBtn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("confess_open")
                        .setLabel("Se confesser")
                        .setStyle(ButtonStyle.Primary)
                );

                await confessChannel.send({
                    embeds: [embed],
                    components: [rowBtn]
                });

                return interaction.reply({
                    content: "✅ Ta confession a été envoyée.",
                    flags: MessageFlags.Ephemeral
                });
            }

            /* =============================================
               PARTIE 2 : GIVEAWAYS
            ============================================= */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith("giveaway_")
            ) {
                const [, action, messageId] =
                    interaction.customId.split("_");

                if (!bot.giveawaysManager) {
                    return interaction.reply({
                        content: "Le système de giveaways est indisponible.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                if (action === "reroll") {
                    try {
                        await bot.giveawaysManager.reroll(messageId);

                        return interaction.reply({
                            content: "Reroll effectué.",
                            flags: MessageFlags.Ephemeral
                        });
                    } catch (error) {
                        console.error("[GIVEAWAY REROLL]", error);

                        return interaction.reply({
                            content: "Erreur lors du reroll.",
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }

                if (action === "end") {
                    try {
                        await bot.giveawaysManager.end(messageId);

                        return interaction.reply({
                            content: "Giveaway terminé !",
                            flags: MessageFlags.Ephemeral
                        });
                    } catch (error) {
                        console.error("[GIVEAWAY END]", error);

                        return interaction.reply({
                            content: "Erreur lors de la fin du giveaway.",
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            }

            /* =============================================
               PARTIE 3 : CAPTCHA
            ============================================= */

            if (
                interaction.isButton() &&
                interaction.customId === "cbutton"
            ) {
                if (!interaction.guild) {
                    return interaction.reply({
                        content: "Cette action fonctionne uniquement sur un serveur.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const row = await dbGet(
                    "SELECT id FROM captcha WHERE guild = ?",
                    [interaction.guild.id]
                ).catch(() => null);

                if (!row?.id) {
                    return interaction.reply({
                        content: "Aucun rôle CAPTCHA n'est configuré.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const role = await interaction.guild.roles
                    .fetch(row.id)
                    .catch(() => null);

                if (!role) {
                    return interaction.reply({
                        content: "Le rôle CAPTCHA est introuvable.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                try {
                    await interaction.member.roles.add(role);

                    return interaction.reply({
                        content: "✅ Vérification effectuée.",
                        flags: MessageFlags.Ephemeral
                    });
                } catch (error) {
                    console.error("[CAPTCHA]", error);

                    return interaction.reply({
                        content: "Impossible de t'attribuer le rôle.",
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            /* =============================================
               PARTIE 4 : SUGGESTIONS
            ============================================= */

            if (
                interaction.isButton() &&
                interaction.customId === "suggest_open"
            ) {
                const modal = new ModalBuilder()
                    .setCustomId("suggest_modal")
                    .setTitle("Faire une suggestion");

                const input = new TextInputBuilder()
                    .setCustomId("suggest_text")
                    .setLabel("Ta suggestion")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(2000);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(input)
                );

                return interaction.showModal(modal);
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId === "suggest_modal"
            ) {
                if (!interaction.guild) {
                    return interaction.reply({
                        content: "Cette action fonctionne uniquement sur un serveur.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const suggestion =
                    interaction.fields.getTextInputValue("suggest_text");

                const row = await dbGet(
                    "SELECT channel FROM Suggest WHERE guildId = ?",
                    [interaction.guild.id]
                ).catch(() => null);

                if (!row || row.channel === "off") {
                    return interaction.reply({
                        content: "Le salon de suggestion n'est pas configuré.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const suggestChannel =
                    interaction.guild.channels.cache.get(row.channel);

                if (!suggestChannel) {
                    return interaction.reply({
                        content: "Le salon de suggestion est introuvable.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const messages = await suggestChannel.messages
                    .fetch({ limit: 10 })
                    .catch(() => null);

                const lastBotMsg = messages?.find(
                    message =>
                        message.author.id === interaction.client.user.id &&
                        message.components.length > 0
                );

                if (lastBotMsg) {
                    await lastBotMsg.edit({ components: [] }).catch(() => {});
                }

                const embed = new EmbedBuilder()
                    .setAuthor({
                        name: interaction.user.tag,
                        iconURL: interaction.user.displayAvatarURL()
                    })
                    .setTitle("Suggestion")
                    .setDescription(suggestion)
                    .setColor(config.color);

                const rowBtn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("suggest_open")
                        .setLabel("Faire une suggestion")
                        .setStyle(ButtonStyle.Primary)
                );

                const sentMsg = await suggestChannel.send({
                    embeds: [embed],
                    components: [rowBtn]
                });

                await sentMsg.react("✅");
                await sentMsg.react("❌");

                return interaction.reply({
                    content: "✅ Ta suggestion a été envoyée.",
                    flags: MessageFlags.Ephemeral
                });
            }

            /* =============================================
               PARTIE 5 : CRÉATION DE TICKETS
               Utilise ticket_categories et tickets
            ============================================= */

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId === "ticket_select"
            ) {
                if (!interaction.guild) {
                    return interaction.reply({
                        content: "Cette action fonctionne uniquement sur un serveur.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                try {
                    await ensureClaimColumn();

                    const guild = interaction.guild;
                    const userId = interaction.user.id;
                    const categoryConfigId = Number(interaction.values[0]);

                    if (!Number.isInteger(categoryConfigId)) {
                        return interaction.reply({
                            content: "❌ Configuration de ticket invalide.",
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const ticketConfig = await dbGet(
                        `SELECT * FROM ticket_categories
                         WHERE id = ? AND guild = ?`,
                        [categoryConfigId, guild.id]
                    );

                    if (!ticketConfig) {
                        return interaction.reply({
                            content: "❌ Cette raison de ticket n'existe plus. Actualise le panel.",
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const existingTickets = await dbAll(
                        `SELECT channel_id FROM tickets
                         WHERE guild = ? AND user_id = ? AND ticket_category_id = ?`,
                        [guild.id, userId, ticketConfig.id]
                    );

                    for (const ticket of existingTickets) {
                        const existingChannel = await guild.channels
                            .fetch(ticket.channel_id)
                            .catch(() => null);

                        if (existingChannel) {
                            return interaction.reply({
                                content: `❌ Tu as déjà un ticket pour cette raison : ${existingChannel}`,
                                flags: MessageFlags.Ephemeral
                            });
                        }

                        await dbRun(
                            "DELETE FROM tickets WHERE channel_id = ?",
                            [ticket.channel_id]
                        );
                    }

                    const category = await guild.channels
                        .fetch(ticketConfig.category_id)
                        .catch(() => null);

                    if (
                        !category ||
                        category.type !== ChannelType.GuildCategory
                    ) {
                        return interaction.reply({
                            content: "❌ La catégorie configurée est introuvable. Utilise à nouveau `ticket add`.",
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    let staffRole = null;

                    if (ticketConfig.role_id) {
                        staffRole = await guild.roles
                            .fetch(ticketConfig.role_id)
                            .catch(() => null);
                    }

                    const username = normalizeChannelName(
                        interaction.user.username
                    ).slice(0, 55) || "utilisateur";

                    const reasonSlug = normalizeChannelName(
                        ticketConfig.reason
                    ).slice(0, 30) || "support";

                    const channelName =
                        `${reasonSlug}-${username}`.slice(0, 100);

                    const permissionOverwrites = [
                        {
                            id: guild.roles.everyone.id,
                            deny: [PermissionsBitField.Flags.ViewChannel]
                        },
                        {
                            id: userId,
                            allow: [
                                PermissionsBitField.Flags.ViewChannel,
                                PermissionsBitField.Flags.SendMessages,
                                PermissionsBitField.Flags.ReadMessageHistory,
                                PermissionsBitField.Flags.AttachFiles,
                                PermissionsBitField.Flags.EmbedLinks
                            ]
                        },
                        {
                            id: interaction.client.user.id,
                            allow: [
                                PermissionsBitField.Flags.ViewChannel,
                                PermissionsBitField.Flags.SendMessages,
                                PermissionsBitField.Flags.ReadMessageHistory,
                                PermissionsBitField.Flags.ManageChannels,
                                PermissionsBitField.Flags.AttachFiles,
                                PermissionsBitField.Flags.EmbedLinks
                            ]
                        }
                    ];

                    if (staffRole) {
                        permissionOverwrites.push({
                            id: staffRole.id,
                            allow: [
                                PermissionsBitField.Flags.ViewChannel,
                                PermissionsBitField.Flags.SendMessages,
                                PermissionsBitField.Flags.ReadMessageHistory
                            ]
                        });
                    }

                    const ticketChannel = await guild.channels.create({
                        name: channelName,
                        type: ChannelType.GuildText,
                        parent: category.id,
                        permissionOverwrites
                    });

                    try {
                        await dbRun(
                            `INSERT INTO tickets (
                                guild,
                                channel_id,
                                user_id,
                                ticket_category_id,
                                reason,
                                created_at,
                                claimed_by
                            ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
                            [
                                guild.id,
                                ticketChannel.id,
                                userId,
                                ticketConfig.id,
                                ticketConfig.reason,
                                Date.now()
                            ]
                        );

                        const embed = buildTicketEmbed({
                            reason: ticketConfig.reason,
                            description: ticketConfig.description,
                            userId,
                            categoryName: category.name,
                            staffRoleId: staffRole?.id,
                            claimedBy: null,
                            color: config.color
                        });

                        await ticketChannel.send({
                            content:
                                `🎫 <@${userId}>` +
                                (staffRole ? ` <@&${staffRole.id}>` : ""),
                            embeds: [embed],
                            components: [buildTicketButtons()],
                            allowedMentions: {
                                users: [userId],
                                roles: staffRole ? [staffRole.id] : []
                            }
                        });
                    } catch (error) {
                        await dbRun(
                            "DELETE FROM tickets WHERE channel_id = ?",
                            [ticketChannel.id]
                        ).catch(() => {});

                        await ticketChannel.delete().catch(() => {});
                        throw error;
                    }

                    return interaction.reply({
                        content: `✅ Ton ticket a été créé dans ${category} : ${ticketChannel}`,
                        flags: MessageFlags.Ephemeral
                    });

                } catch (error) {
                    console.error("[TICKET CREATE]", error);

                    if (interaction.replied || interaction.deferred) {
                        return interaction.followUp({
                            content: "❌ Impossible de créer le ticket. Vérifie la configuration, la base de données et les permissions du bot.",
                            flags: MessageFlags.Ephemeral
                        }).catch(() => {});
                    }

                    return interaction.reply({
                        content: "❌ Impossible de créer le ticket. Vérifie la configuration, la base de données et les permissions du bot.",
                        flags: MessageFlags.Ephemeral
                    }).catch(() => {});
                }
            }

            /* =============================================
               PARTIE 6 : CLAIM DU TICKET
            ============================================= */

            if (
                interaction.isButton() &&
                interaction.customId === "ticket_claim"
            ) {
                if (!interaction.guild || !interaction.channel) {
                    return interaction.reply({
                        content: "❌ Cette action fonctionne uniquement dans un ticket.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                try {
                    await ensureClaimColumn();

                    const ticket = await dbGet(
                        `SELECT
                            t.*,
                            tc.description,
                            tc.category_id,
                            tc.role_id
                         FROM tickets t
                         LEFT JOIN ticket_categories tc
                            ON tc.id = t.ticket_category_id
                         WHERE t.channel_id = ? AND t.guild = ?`,
                        [interaction.channel.id, interaction.guild.id]
                    );

                    if (!ticket) {
                        return interaction.reply({
                            content: "❌ Ce salon n'est pas enregistré dans la table tickets.",
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const member = await interaction.guild.members.fetch(
                        interaction.user.id
                    );

                    const isStaffRole =
                        Boolean(ticket.role_id) &&
                        member.roles.cache.has(ticket.role_id);

                    const hasStaffPermission = member.permissions.has(
                        PermissionsBitField.Flags.ManageChannels
                    ) || member.permissions.has(
                        PermissionsBitField.Flags.Administrator
                    );

                    if (!isStaffRole && !hasStaffPermission) {
                        return interaction.reply({
                            content: "❌ Seul le staff autorisé peut prendre ce ticket en charge.",
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    if (ticket.claimed_by) {
                        return interaction.reply({
                            content: ticket.claimed_by === interaction.user.id
                                ? "ℹ️ Tu as déjà pris ce ticket en charge."
                                : `❌ Ce ticket est déjà pris en charge par <@${ticket.claimed_by}>.`,
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const result = await dbRun(
                        `UPDATE tickets
                         SET claimed_by = ?
                         WHERE channel_id = ?
                           AND (claimed_by IS NULL OR claimed_by = '')`,
                        [interaction.user.id, interaction.channel.id]
                    );

                    if (result.changes === 0) {
                        return interaction.reply({
                            content: "❌ Un autre membre vient de prendre ce ticket en charge.",
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const category = ticket.category_id
                        ? await interaction.guild.channels
                            .fetch(ticket.category_id)
                            .catch(() => null)
                        : null;

                    const embed = buildTicketEmbed({
                        reason: ticket.reason,
                        description: ticket.description,
                        userId: ticket.user_id,
                        categoryName: category?.name || "Support",
                        staffRoleId: ticket.role_id,
                        claimedBy: interaction.user.id,
                        color: config.color
                    });

                    await interaction.update({
                        embeds: [embed],
                        components: [buildTicketButtons(interaction.user.id)]
                    });

                    await interaction.channel.send({
                        content: `🙋 Ce ticket est maintenant pris en charge par ${interaction.user}.`,
                        allowedMentions: {
                            users: [interaction.user.id]
                        }
                    });

                } catch (error) {
                    console.error("[TICKET CLAIM]", error);

                    if (!interaction.replied && !interaction.deferred) {
                        return interaction.reply({
                            content: "❌ Impossible de prendre ce ticket en charge.",
                            flags: MessageFlags.Ephemeral
                        }).catch(() => {});
                    }
                }

                return;
            }

            /* =============================================
               PARTIE 7 : FERMETURE DU TICKET AVEC HTML
            ============================================= */

            if (
                interaction.isButton() &&
                [
                    "ticket_close",
                    "close_ticket",
                    "close-ticket"
                ].includes(interaction.customId)
            ) {
                if (!interaction.guild || !interaction.channel) {
                    return interaction.reply({
                        content: "Cette action fonctionne uniquement dans un ticket.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.deferReply({
                    flags: MessageFlags.Ephemeral
                });

                try {
                    await closeTicketWithTranscript(interaction);

                    await interaction.editReply({
                        content: "✅ Ticket fermé. Le transcript HTML a été envoyé dans 📁・ticket-logs."
                    }).catch(() => {});
                } catch (error) {
                    console.error("[TICKET CLOSE]", error);

                    await interaction.editReply({
                        content: `❌ ${error.message || "La fermeture du ticket a échoué."}`
                    }).catch(() => {});
                }

                return;
            }

            /* =============================================
               PARTIE 8 : VÉRIFICATION D'IDENTITÉ
            ============================================= */

            if (
                interaction.isButton() &&
                interaction.customId === "startVerif"
            ) {
                const modal = new ModalBuilder()
                    .setCustomId("verifModal")
                    .setTitle("Vérification d'identité");

                const prenom = new TextInputBuilder()
                    .setCustomId("prenom")
                    .setLabel("Votre prénom")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(50);

                const nom = new TextInputBuilder()
                    .setCustomId("nom")
                    .setLabel("Votre nom de famille")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(50);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(prenom),
                    new ActionRowBuilder().addComponents(nom)
                );

                return interaction.showModal(modal);
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId === "verifModal"
            ) {
                if (!interaction.guild) {
                    return interaction.reply({
                        content: "Cette action fonctionne uniquement sur un serveur.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const prenomRaw =
                    interaction.fields.getTextInputValue("prenom");

                const nomRaw =
                    interaction.fields.getTextInputValue("nom");

                const prenomClean = prenomRaw.trim();
                const nomClean = nomRaw.trim();

                if (!prenomClean || !nomClean) {
                    return interaction.reply({
                        content: "Le prénom et le nom sont obligatoires.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const prenom =
                    prenomClean.charAt(0).toUpperCase() +
                    prenomClean.slice(1).toLowerCase();

                const nom = nomClean.toUpperCase();
                const newNickname = `${prenom} ${nom}`;

                const dejaPris = interaction.guild.members.cache.find(
                    member =>
                        member.id !== interaction.user.id &&
                        (
                            member.nickname === newNickname ||
                            member.user.username === newNickname
                        )
                );

                if (dejaPris) {
                    return interaction.reply({
                        content:
                            `❌ Malheureusement, le nom **${newNickname}** est déjà utilisé.`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.reply({
                    content:
                        `✅ Merci **${newNickname}**, votre vérification a bien été enregistrée.`,
                    flags: MessageFlags.Ephemeral
                });

                const roleRow = await dbGet(
                    "SELECT roleId FROM verifrole WHERE guildId = ?",
                    [interaction.guild.id]
                ).catch(() => null);

                const role = roleRow?.roleId
                    ? await interaction.guild.roles
                        .fetch(roleRow.roleId)
                        .catch(() => null)
                    : null;

                if (role) {
                    try {
                        await interaction.member.roles.add(role);
                    } catch (error) {
                        console.error("[VERIF ROLE]", error);
                    }
                }

                try {
                    await interaction.member.setNickname(newNickname);
                } catch (error) {
                    console.error("[VERIF NICKNAME]", error);
                }

                const logChannel =
                    interaction.guild.channels.cache.find(
                        channel => channel.name === "📁・verif-logs"
                    );

                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle("Nouvelle vérification")
                        .setColor(config.color)
                        .addFields(
                            {
                                name: "Utilisateur",
                                value: interaction.user.tag,
                                inline: false
                            },
                            {
                                name: "Prénom",
                                value: prenom,
                                inline: true
                            },
                            {
                                name: "Nom",
                                value: nom,
                                inline: true
                            },
                            {
                                name: "Pseudo final",
                                value: newNickname,
                                inline: false
                            }
                        )
                        .setTimestamp();

                    await logChannel.send({
                        embeds: [embed]
                    }).catch(() => {});
                }

                return;
            }

            /* =============================================
               PARTIE 9 : MENU DES NOTIFICATIONS
            ============================================= */

            const notifPath = path.join(
                __dirname,
                "../database/notifications.json"
            );

            if (!fs.existsSync(path.dirname(notifPath))) {
                fs.mkdirSync(path.dirname(notifPath), {
                    recursive: true
                });
            }

            if (!fs.existsSync(notifPath)) {
                fs.writeFileSync(notifPath, "{}");
            }

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId === "notif_menu"
            ) {
                if (!interaction.guild) {
                    return interaction.reply({
                        content: "Cette action fonctionne uniquement sur un serveur.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                let notifData = {};

                try {
                    notifData = JSON.parse(
                        fs.readFileSync(notifPath, "utf8")
                    );
                } catch (error) {
                    console.error("[NOTIFICATIONS JSON]", error);

                    return interaction.reply({
                        content: "Le fichier de configuration des notifications est invalide.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const guildId = interaction.guild.id;

                if (!notifData[guildId]) {
                    return interaction.reply({
                        content: "⚠️ Aucun rôle configuré.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const index = interaction.values[0];
                const roleId = notifData[guildId][index]?.id;

                if (!roleId) {
                    return interaction.reply({
                        content: "⚠️ Rôle introuvable dans la configuration.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const role = await interaction.guild.roles
                    .fetch(roleId)
                    .catch(() => null);

                if (!role) {
                    return interaction.reply({
                        content: "⚠️ Le rôle configuré n'existe plus.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const member = await interaction.guild.members.fetch(
                    interaction.user.id
                );

                if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(roleId);

                    return interaction.reply({
                        content: `❌ Tu ne recevras plus **${role.name}**.`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                await member.roles.add(roleId);

                return interaction.reply({
                    content: `✅ Tu recevras maintenant **${role.name}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            /* =============================================
               PARTIE 10 : BOUTONS DE RÔLES DES EMBEDS
            ============================================= */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(ROLE_BUTTON_PREFIX)
            ) {
                if (!interaction.guild) {
                    return interaction.reply({
                        content: "❌ Ce bouton fonctionne uniquement sur un serveur.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                const roleId = interaction.customId.slice(
                    ROLE_BUTTON_PREFIX.length
                );

                if (!/^\d{17,20}$/.test(roleId)) {
                    return interaction.reply({
                        content: "❌ L'identifiant du rôle est invalide.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                try {
                    const guild = interaction.guild;
                    const role = await guild.roles.fetch(roleId);

                    if (!role) {
                        return interaction.reply({
                            content: "❌ Ce rôle n'existe plus.",
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const member = await guild.members.fetch(
                        interaction.user.id
                    );

                    const botMember = await guild.members.fetchMe();

                    if (
                        !botMember.permissions.has(
                            PermissionsBitField.Flags.ManageRoles
                        )
                    ) {
                        return interaction.reply({
                            content: "❌ Je n'ai pas la permission Gérer les rôles.",
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    if (role.id === guild.id || !role.editable) {
                        return interaction.reply({
                            content:
                                "❌ Je ne peux pas gérer ce rôle. Vérifie la hiérarchie des rôles.",
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    if (member.roles.cache.has(roleId)) {
                        await member.roles.remove(roleId);

                        return interaction.reply({
                            content: `✅ Le rôle ${role} t'a été retiré.`,
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    await member.roles.add(roleId);

                    return interaction.reply({
                        content: `✅ Le rôle ${role} t'a été attribué.`,
                        flags: MessageFlags.Ephemeral
                    });
                } catch (error) {
                    console.error("[EMBED ROLE BUTTON]", error);

                    if (!interaction.replied && !interaction.deferred) {
                        return interaction.reply({
                            content:
                                "❌ Impossible de modifier ce rôle. Vérifie les permissions du bot et la hiérarchie des rôles.",
                            flags: MessageFlags.Ephemeral
                        }).catch(() => {});
                    }
                }
            }

        } catch (error) {
            console.error("[INTERACTION CREATE]", error);

            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        "❌ Une erreur est survenue pendant le traitement de cette interaction.",
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
        }
    }
};

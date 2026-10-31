const {
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const db = require('./loadDatabase');
const config = require('../config.json');

/* =========================================================
   DATABASE
========================================================= */

function dbRun(sql, params = []) {

    return new Promise((resolve, reject) => {

        db.run(sql, params, function (err) {

            if (err) {
                reject(err);
                return;
            }

            resolve(this);
        });
    });
}

function dbGet(sql, params = []) {

    return new Promise((resolve, reject) => {

        db.get(sql, params, (err, row) => {

            if (err) {
                reject(err);
                return;
            }

            resolve(row);
        });
    });
}

async function initDatabase() {

    await dbRun(`
        CREATE TABLE IF NOT EXISTS ticket_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild TEXT NOT NULL,
            reason TEXT NOT NULL,
            description TEXT DEFAULT '',
            category_id TEXT NOT NULL,
            role_id TEXT DEFAULT NULL,
            UNIQUE(guild, reason)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild TEXT NOT NULL,
            channel_id TEXT NOT NULL UNIQUE,
            user_id TEXT NOT NULL,
            ticket_category_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    `);
}

/* =========================================================
   CREATION TICKET
========================================================= */

async function createTicket(interaction) {

    await initDatabase();

    const categoryId = interaction.values[0];

    /*
     * On récupère la configuration de la raison.
     */

    const ticketCategory = await dbGet(
        `
        SELECT *
        FROM ticket_categories
        WHERE id = ?
        AND guild = ?
        `,
        [
            categoryId,
            interaction.guild.id
        ]
    );

    if (!ticketCategory) {

        return interaction.reply({
            content:
                '❌ Cette raison de ticket n’existe plus.',
            ephemeral: true
        });
    }

    /*
     * Vérifie si le membre possède déjà un ticket.
     */

    const existing = await dbGet(
        `
        SELECT channel_id
        FROM tickets
        WHERE guild = ?
        AND user_id = ?
        `,
        [
            interaction.guild.id,
            interaction.user.id
        ]
    );

    if (existing) {

        const existingChannel =
            interaction.guild.channels.cache.get(
                existing.channel_id
            );

        if (existingChannel) {

            return interaction.reply({
                content:
                    `❌ Tu as déjà un ticket ouvert : ${existingChannel}`,
                ephemeral: true
            });
        }

        /*
         * Le salon n'existe plus.
         * On nettoie la base.
         */

        await dbRun(
            `
            DELETE FROM tickets
            WHERE guild = ?
            AND channel_id = ?
            `,
            [
                interaction.guild.id,
                existing.channel_id
            ]
        );
    }

    /*
     * Nom du membre.
     */

    let username = interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 20);

    if (!username) {
        username = 'user';
    }

    const channelName =
        `ticket-${username}-${ticketCategory.id}`;

    /*
     * Permissions du ticket.
     */

    const permissionOverwrites = [

        /*
         * @everyone
         */

        {
            id: interaction.guild.id,

            deny: [
                PermissionFlagsBits.ViewChannel
            ]
        },

        /*
         * Créateur
         */

        {
            id: interaction.user.id,

            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
            ]
        },

        /*
         * Bot
         */

        {
            id: interaction.client.user.id,

            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        }
    ];

    /*
     * Rôle autorisé.
     */

    if (ticketCategory.role_id) {

        permissionOverwrites.push({

            id: ticketCategory.role_id,

            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
            ]
        });
    }

    /*
     * Vérifie que la catégorie existe.
     */

    const category =
        interaction.guild.channels.cache.get(
            ticketCategory.category_id
        );

    if (!category || category.type !== 4) {

        return interaction.reply({
            content:
                '❌ La catégorie configurée pour ce ticket n’existe plus.',
            ephemeral: true
        });
    }

    /*
     * Création du salon.
     */

    const channel =
        await interaction.guild.channels.create({

            name: channelName,

            type: ChannelType.GuildText,

            parent: category.id,

            permissionOverwrites,

            topic:
                `Ticket de ${interaction.user.tag} | ` +
                `Raison : ${ticketCategory.reason}`
        });

    /*
     * Enregistrement DB.
     */

    await dbRun(
        `
        INSERT INTO tickets
        (
            guild,
            channel_id,
            user_id,
            ticket_category_id,
            reason,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
            interaction.guild.id,
            channel.id,
            interaction.user.id,
            ticketCategory.id,
            ticketCategory.reason,
            Date.now()
        ]
    );

    /*
     * Embed du ticket.
     */

    const embed = new EmbedBuilder()
        .setTitle(`🎫 ${ticketCategory.reason}`)
        .setDescription(

            `Bienvenue ${interaction.user} !\n\n` +

            `**Raison :**\n` +
            `${ticketCategory.reason}\n\n` +

            (
                ticketCategory.description
                    ? `**Description :**\n${ticketCategory.description}\n\n`
                    : ''
            ) +

            `Explique précisément ta demande afin que l'équipe puisse t'aider.`
        )
        .setColor(
            config.color || '#5865F2'
        )
        .setTimestamp();

    /*
     * Bouton fermeture.
     */

    const closeButton =
        new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('Fermer le ticket')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger);

    const row =
        new ActionRowBuilder()
            .addComponents(closeButton);

    /*
     * Message du ticket.
     */

    await channel.send({

        content:
            `${interaction.user}` +

            (
                ticketCategory.role_id
                    ? ` <@&${ticketCategory.role_id}>`
                    : ''
            ),

        embeds: [embed],

        components: [row],

        allowedMentions: {

            users: [
                interaction.user.id
            ],

            roles:
                ticketCategory.role_id
                    ? [ticketCategory.role_id]
                    : []
        }
    });

    /*
     * Réponse à l'utilisateur.
     */

    return interaction.reply({

        content:
            `✅ Ton ticket a été créé : ${channel}`,

        ephemeral: true
    });
}

/* =========================================================
   FERMETURE
========================================================= */

async function closeTicket(interaction) {

    await initDatabase();

    const ticket = await dbGet(
        `
        SELECT *
        FROM tickets
        WHERE guild = ?
        AND channel_id = ?
        `,
        [
            interaction.guild.id,
            interaction.channel.id
        ]
    );

    if (!ticket) {

        return interaction.reply({
            content:
                '❌ Ce salon n’est pas un ticket enregistré.',
            ephemeral: true
        });
    }

    /*
     * Autorise :
     *
     * - le propriétaire ;
     * - le rôle de la catégorie ;
     * - les administrateurs.
     */

    const member = interaction.member;

    const isOwner =
        ticket.user_id === interaction.user.id;

    const isAdmin =
        member.permissions.has(
            PermissionFlagsBits.Administrator
        );

    const category =
        await dbGet(
            `
            SELECT role_id
            FROM ticket_categories
            WHERE id = ?
            `,
            [
                ticket.ticket_category_id
            ]
        );

    const hasStaffRole =
        category?.role_id &&
        member.roles.cache.has(
            category.role_id
        );

    if (
        !isOwner &&
        !isAdmin &&
        !hasStaffRole
    ) {

        return interaction.reply({
            content:
                '❌ Tu n’as pas la permission de fermer ce ticket.',
            ephemeral: true
        });
    }

    await interaction.reply({
        content:
            '🔒 Ticket fermé. Suppression du salon dans 5 secondes...'
    });

    await dbRun(
        `
        DELETE FROM tickets
        WHERE channel_id = ?
        `,
        [
            interaction.channel.id
        ]
    );

    setTimeout(() => {

        interaction.channel
            .delete('Ticket fermé')
            .catch(error => {
                console.error(
                    '[TICKET DELETE]',
                    error
                );
            });

    }, 5000);
}

/* =========================================================
   HANDLER
========================================================= */

module.exports = async function ticketInteraction(interaction) {

    try {

        if (!interaction.guild) {
            return;
        }

        /*
         * Select Menu
         */

        if (
            interaction.isStringSelectMenu() &&
            interaction.customId === 'ticket_select'
        ) {

            return createTicket(interaction);
        }

        /*
         * Bouton fermeture
         */

        if (
            interaction.isButton() &&
            interaction.customId === 'ticket_close'
        ) {

            return closeTicket(interaction);
        }

    } catch (error) {

        console.error(
            '[TICKET INTERACTION]',
            error
        );

        if (
            !interaction.replied &&
            !interaction.deferred
        ) {

            await interaction.reply({
                content:
                    '❌ Une erreur est survenue.',
                ephemeral: true
            }).catch(() => {});
        }
    }
};
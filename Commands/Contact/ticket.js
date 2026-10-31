
const {
    EmbedBuilder,
    StringSelectMenuBuilder,
    ActionRowBuilder,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

const db = require('../../Events/loadDatabase');
const config = require('../../config.json');

/*
 * =========================================================
 * BASE DE DONNÉES
 * =========================================================
 */

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
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

    await dbRun(`
        CREATE TABLE IF NOT EXISTS ticket_panels (
            guild_id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            message_id TEXT NOT NULL
        )
    `);

    // Migration pour les anciennes bases de données.
    const columns = await dbAll(`PRAGMA table_info(ticket_categories)`);

    const hasDescription = columns.some(c => c.name === 'description');
    const hasCategory = columns.some(c => c.name === 'category_id');
    const hasRole = columns.some(c => c.name === 'role_id');

    if (!hasDescription) {
        await dbRun(
            `ALTER TABLE ticket_categories ADD COLUMN description TEXT DEFAULT ''`
        );
    }

    if (!hasCategory) {
        await dbRun(
            `ALTER TABLE ticket_categories ADD COLUMN category_id TEXT`
        );
    }

    if (!hasRole) {
        await dbRun(
            `ALTER TABLE ticket_categories ADD COLUMN role_id TEXT DEFAULT NULL`
        );
    }
}

/*
 * =========================================================
 * PERMISSIONS DE LA COMMANDE
 * =========================================================
 */

async function hasPermission(bot, message) {
    if (!message.guild) return false;

    const userId = message.author.id;
    const guildId = message.guild.id;

    if (
        Array.isArray(config.owner) &&
        config.owner.map(String).includes(String(userId))
    ) {
        return true;
    }

    if (
        message.member?.permissions.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        return true;
    }

    const permissionTables = [
        {
            sql: 'SELECT 1 FROM whitelist WHERE guild = ? AND user = ?',
            params: [guildId, userId]
        },
        {
            sql: 'SELECT 1 FROM owner WHERE guild = ? AND user = ?',
            params: [guildId, userId]
        },
        {
            sql: 'SELECT 1 FROM permissions WHERE guild = ? AND user = ?',
            params: [guildId, userId]
        },
        {
            sql: 'SELECT 1 FROM cmdperm WHERE guild = ? AND user = ? AND command = ?',
            params: [guildId, userId, 'ticket']
        }
    ];

    for (const query of permissionTables) {
        try {
            const result = await dbGet(query.sql, query.params);
            if (result) return true;
        } catch {
            // Une table de permissions peut ne pas exister.
        }
    }

    return false;
}

/*
 * =========================================================
 * PANEL
 * =========================================================
 */

function buildPanelEmbed() {
    return new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎫 Support')
        .setDescription(
            'Sélectionnez la raison de votre demande dans le menu ci-dessous.\n\n' +
            'Un salon privé sera automatiquement créé dans la catégorie correspondante.'
        )
        .setFooter({
            text: 'Système de tickets'
        })
        .setTimestamp();
}

function buildPanelComponents(categories) {
    // Un menu Discord accepte 25 options maximum.
    const limitedCategories = categories.slice(0, 25);

    if (!limitedCategories.length) return [];

    const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_select')
        .setPlaceholder('🎫 Choisissez une raison...')
        .addOptions(
            limitedCategories.map(row => ({
                label: String(row.reason).slice(0, 100),
                value: String(row.id),
                description: String(
                    row.description || 'Créer un ticket'
                ).slice(0, 100)
            }))
        );

    return [
        new ActionRowBuilder().addComponents(menu)
    ];
}

async function syncPanel(bot, guildId) {
    const panel = await dbGet(
        `SELECT * FROM ticket_panels WHERE guild_id = ?`,
        [guildId]
    );

    if (!panel) return false;

    let guild = bot.guilds.cache.get(guildId);

    if (!guild) {
        guild = await bot.guilds.fetch(guildId).catch(() => null);
    }

    if (!guild) return false;

    const channel = await guild.channels
        .fetch(panel.channel_id)
        .catch(() => null);

    if (!channel || !channel.isTextBased() || !channel.messages) {
        await dbRun(
            `DELETE FROM ticket_panels WHERE guild_id = ?`,
            [guildId]
        );
        return false;
    }

    const panelMessage = await channel.messages
        .fetch(panel.message_id)
        .catch(() => null);

    if (!panelMessage) {
        await dbRun(
            `DELETE FROM ticket_panels WHERE guild_id = ?`,
            [guildId]
        );
        return false;
    }

    const categories = await dbAll(
        `SELECT * FROM ticket_categories WHERE guild = ? ORDER BY id ASC`,
        [guildId]
    );

    await panelMessage.edit({
        embeds: [buildPanelEmbed()],
        components: buildPanelComponents(categories)
    });

    return true;
}

async function createOrUpdatePanel(bot, message) {
    const guildId = message.guild.id;

    const categories = await dbAll(
        `SELECT * FROM ticket_categories WHERE guild = ? ORDER BY id ASC`,
        [guildId]
    );

    const existingPanel = await dbGet(
        `SELECT * FROM ticket_panels WHERE guild_id = ?`,
        [guildId]
    );

    if (existingPanel) {
        const channel = await message.guild.channels
            .fetch(existingPanel.channel_id)
            .catch(() => null);

        if (channel?.isTextBased() && channel.messages) {
            const panelMessage = await channel.messages
                .fetch(existingPanel.message_id)
                .catch(() => null);

            if (panelMessage) {
                await panelMessage.edit({
                    embeds: [buildPanelEmbed()],
                    components: buildPanelComponents(categories)
                });

                return message.reply({
                    content: '✅ Le panel de tickets a été mis à jour.',
                    allowedMentions: { repliedUser: false }
                });
            }
        }

        await dbRun(
            `DELETE FROM ticket_panels WHERE guild_id = ?`,
            [guildId]
        );
    }

    const panelMessage = await message.channel.send({
        embeds: [buildPanelEmbed()],
        components: buildPanelComponents(categories)
    });

    await dbRun(
        `INSERT INTO ticket_panels (guild_id, channel_id, message_id)
         VALUES (?, ?, ?)`,
        [guildId, message.channel.id, panelMessage.id]
    );

    return message.reply({
        content: '✅ Panel de tickets créé.',
        allowedMentions: { repliedUser: false }
    });
}

/*
 * =========================================================
 * SYNCHRONISATION AU DÉMARRAGE
 * =========================================================
 */

exports.syncAllPanels = async function (bot) {
    try {
        await initDatabase();

        const panels = await dbAll(
            `SELECT guild_id FROM ticket_panels`
        );

        for (const panel of panels) {
            try {
                await syncPanel(bot, panel.guild_id);
            } catch (err) {
                console.error(
                    `[TICKET] Erreur panel ${panel.guild_id}:`,
                    err
                );
            }
        }

        console.log(
            `[TICKET] ${panels.length} panel(s) synchronisé(s).`
        );
    } catch (err) {
        console.error('[TICKET] Erreur de synchronisation :', err);
    }
};

/*
 * =========================================================
 * CRÉATION DU TICKET VIA LE MENU
 * =========================================================
 */

exports.handleInteraction = async function (interaction) {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'ticket_select') return;
    if (!interaction.guild) return;

    try {
        await initDatabase();

        const guild = interaction.guild;
        const userId = interaction.user.id;
        const categoryConfigId = Number(interaction.values[0]);

        if (!Number.isInteger(categoryConfigId)) {
            return interaction.reply({
                content: '❌ Catégorie invalide.',
                ephemeral: true
            });
        }

        const ticketConfig = await dbGet(
            `SELECT * FROM ticket_categories WHERE id = ? AND guild = ?`,
            [categoryConfigId, guild.id]
        );

        if (!ticketConfig) {
            return interaction.reply({
                content: '❌ Cette configuration de ticket n’existe plus.',
                ephemeral: true
            });
        }

        // Empêche l'ouverture de plusieurs tickets pour la même raison.
        const existingTickets = await dbAll(
            `SELECT * FROM tickets
             WHERE guild = ? AND user_id = ? AND ticket_category_id = ?`,
            [guild.id, userId, ticketConfig.id]
        );

        for (const ticket of existingTickets) {
            const channel = await guild.channels
                .fetch(ticket.channel_id)
                .catch(() => null);

            if (channel) {
                return interaction.reply({
                    content: `❌ Tu as déjà un ticket ouvert pour cette raison : ${channel}`,
                    ephemeral: true
                });
            }

            // Supprime les entrées correspondant à des salons disparus.
            await dbRun(
                `DELETE FROM tickets WHERE channel_id = ?`,
                [ticket.channel_id]
            );
        }

        const discordCategory = await guild.channels
            .fetch(ticketConfig.category_id)
            .catch(() => null);

        if (
            !discordCategory ||
            discordCategory.type !== ChannelType.GuildCategory
        ) {
            return interaction.reply({
                content:
                    '❌ La catégorie Discord enregistrée est introuvable. ' +
                    'Utilise `ticket add` pour la reconfigurer.',
                ephemeral: true
            });
        }

        let staffRole = null;

        if (ticketConfig.role_id) {
            staffRole = await guild.roles
                .fetch(ticketConfig.role_id)
                .catch(() => null);
        }

        const username = interaction.user.username
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 70) || 'utilisateur';

        const permissionOverwrites = [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: userId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            },
            {
                id: interaction.client.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageChannels
                ]
            }
        ];

        if (staffRole) {
            permissionOverwrites.push({
                id: staffRole.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            });
        }

        // Création du salon DANS la catégorie Discord choisie.
        const channel = await guild.channels.create({
            name: `ticket-${username}`.slice(0, 100),
            type: ChannelType.GuildText,
            parent: discordCategory.id,
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
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    guild.id,
                    channel.id,
                    userId,
                    ticketConfig.id,
                    ticketConfig.reason,
                    Date.now()
                ]
            );

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🎫 Nouveau ticket')
                .setDescription(
                    `Bonjour <@${userId}>, bienvenue dans ton ticket.\n\n` +
                    `**Motif :** ${ticketConfig.reason}\n` +
                    `**Description :** ${ticketConfig.description || 'Aucune'}\n` +
                    `**Catégorie Discord :** ${discordCategory.name}\n` +
                    `**Équipe :** ${staffRole ? `<@&${staffRole.id}>` : 'Aucun rôle configuré'}`
                )
                .setTimestamp();

            await channel.send({
                content: `<@${userId}>${staffRole ? ` <@&${staffRole.id}>` : ''}`,
                embeds: [embed],
                allowedMentions: {
                    users: [userId],
                    roles: staffRole ? [staffRole.id] : []
                }
            });
        } catch (err) {
            await dbRun(
                `DELETE FROM tickets WHERE channel_id = ?`,
                [channel.id]
            ).catch(() => {});

            await channel.delete().catch(() => {});
            throw err;
        }

        return interaction.reply({
            content: `✅ Ton ticket a été créé : ${channel}`,
            ephemeral: true
        });

    } catch (err) {
        console.error('[TICKET] Erreur création :', err);

        const response = {
            content:
                '❌ Impossible de créer le ticket. Vérifie les permissions du bot et la configuration.',
            ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
            return interaction.followUp(response).catch(() => {});
        }

        return interaction.reply(response).catch(() => {});
    }
};

/*
 * =========================================================
 * AIDE
 * =========================================================
 */

exports.help = {
    name: 'ticket',
    helpname: 'ticket <add|remove|list|panel>',
    description: 'Configure et gère le système de tickets',
    help: 'ticket <add|remove|list|panel>'
};

/*
 * =========================================================
 * COMMANDE PRINCIPALE
 * =========================================================
 */

exports.run = async function (bot, message, args) {
    try {
        if (!message.guild) {
            return message.reply(
                '❌ Cette commande doit être utilisée dans un serveur.'
            );
        }

        await initDatabase();

        if (!(await hasPermission(bot, message))) {
            return message.reply({
                content: '❌ Vous n’avez pas la permission d’utiliser cette commande.',
                allowedMentions: { repliedUser: false }
            });
        }

        const subCommand = args[0]?.toLowerCase();

        /*
         * TICKET PANEL
         */

        if (subCommand === 'panel') {
            return await createOrUpdatePanel(bot, message);
        }

        /*
         * TICKET ADD
         * ticket add <categoryId> <roleId|none> <raison> | <description>
         */

        if (subCommand === 'add') {
            if (args.length < 4) {
                return message.reply({
                    content:
                        '❌ Utilisation : `ticket add <categoryId> <roleId|none> <raison> | <description>`',
                    allowedMentions: { repliedUser: false }
                });
            }

            const categoryId = args[1];
            const roleId = args[2];
            const rest = args.slice(3).join(' ');
            const parts = rest.split('|');

            const reason = parts[0]?.trim();
            const description = parts.slice(1).join('|').trim();

            if (!reason) {
                return message.reply({
                    content: '❌ Vous devez indiquer une raison.',
                    allowedMentions: { repliedUser: false }
                });
            }

            if (reason.length > 100) {
                return message.reply({
                    content: '❌ La raison ne doit pas dépasser 100 caractères.',
                    allowedMentions: { repliedUser: false }
                });
            }

            const category = await message.guild.channels
                .fetch(categoryId)
                .catch(() => null);

            if (
                !category ||
                category.type !== ChannelType.GuildCategory
            ) {
                return message.reply({
                    content: '❌ La catégorie Discord est introuvable ou invalide.',
                    allowedMentions: { repliedUser: false }
                });
            }

            let finalRoleId = null;

            if (roleId && roleId.toLowerCase() !== 'none') {
                const role = await message.guild.roles
                    .fetch(roleId)
                    .catch(() => null);

                if (!role) {
                    return message.reply({
                        content: '❌ Le rôle indiqué est introuvable.',
                        allowedMentions: { repliedUser: false }
                    });
                }

                finalRoleId = role.id;
            }

            await dbRun(
                `INSERT INTO ticket_categories (
                    guild, reason, description, category_id, role_id
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(guild, reason)
                DO UPDATE SET
                    description = excluded.description,
                    category_id = excluded.category_id,
                    role_id = excluded.role_id`,
                [
                    message.guild.id,
                    reason,
                    description,
                    category.id,
                    finalRoleId
                ]
            );

            await syncPanel(bot, message.guild.id);

            return message.reply({
                content:
                    `✅ La raison **${reason}** a été ajoutée ou modifiée.\n` +
                    `📁 Catégorie : <#${category.id}>\n` +
                    `👥 Rôle : ${finalRoleId ? `<@&${finalRoleId}>` : 'Aucun'}\n` +
                    `🔄 Le panel a été synchronisé.`,
                allowedMentions: {
                    repliedUser: false,
                    roles: []
                }
            });
        }

        /*
         * TICKET REMOVE
         */

        if (subCommand === 'remove') {
            if (args.length < 2) {
                return message.reply({
                    content: '❌ Utilisation : `ticket remove <raison>`',
                    allowedMentions: { repliedUser: false }
                });
            }

            const reason = args.slice(1).join(' ').trim();

            const existing = await dbGet(
                `SELECT * FROM ticket_categories
                 WHERE guild = ? AND reason = ?`,
                [message.guild.id, reason]
            );

            if (!existing) {
                return message.reply({
                    content: `❌ La raison **${reason}** n’existe pas.`,
                    allowedMentions: { repliedUser: false }
                });
            }

            await dbRun(
                `DELETE FROM ticket_categories WHERE guild = ? AND reason = ?`,
                [message.guild.id, reason]
            );

            await syncPanel(bot, message.guild.id);

            return message.reply({
                content:
                    `✅ La raison **${reason}** a été supprimée.\n` +
                    '🔄 Le panel a été synchronisé.',
                allowedMentions: { repliedUser: false }
            });
        }

        /*
         * TICKET LIST
         */

        if (subCommand === 'list') {
            const categories = await dbAll(
                `SELECT * FROM ticket_categories WHERE guild = ? ORDER BY id ASC`,
                [message.guild.id]
            );

            if (!categories.length) {
                return message.reply({
                    content: '📭 Aucune configuration de ticket.',
                    allowedMentions: { repliedUser: false }
                });
            }

            const lines = categories.map(row =>
                `**#${row.id} — ${row.reason}**\n` +
                `> 📁 Catégorie : <#${row.category_id}>\n` +
                `> 👥 Rôle : ${row.role_id ? `<@&${row.role_id}>` : 'Aucun'}\n` +
                `> 📝 Description : ${row.description || 'Aucune'}`
            );

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🎫 Catégories de tickets')
                .setDescription(lines.join('\n\n').slice(0, 4000))
                .setFooter({
                    text: `${categories.length} configuration(s)`
                })
                .setTimestamp();

            return message.reply({
                embeds: [embed],
                allowedMentions: { repliedUser: false }
            });
        }

        /*
         * AIDE
         */

        return message.reply({
            content:
                '**🎫 Commandes tickets**\n\n' +
                '`ticket add <categoryId> <roleId|none> <raison> | <description>`\n' +
                '`ticket remove <raison>`\n' +
                '`ticket list`\n' +
                '`ticket panel`',
            allowedMentions: { repliedUser: false }
        });

    } catch (error) {
        console.error('[TICKET] Erreur commande :', error);

        return message.reply({
            content: '❌ Une erreur est survenue pendant la commande ticket.',
            allowedMentions: { repliedUser: false }
        }).catch(() => {});
    }
};

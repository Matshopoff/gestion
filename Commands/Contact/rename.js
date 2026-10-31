
const db = require('../../Events/loadDatabase');
const config = require('../../config.json');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const sendLog = require('../../Events/sendlog');

exports.help = {
    name: 'rename',
    helpname: 'rename <message>',
    description: 'Permet de renommer un ticket',
    help: 'rename <message>'
};

exports.run = async (bot, message, args) => {
    // =============================================
    // VÉRIFICATIONS DE BASE
    // =============================================

    if (!message.guild || !message.member) return;

    const checkPerm = async (message, commandName) => {
        try {
            if (config.owners?.includes(message.author.id)) {
                return true;
            }

            // Autorisation des commandes publiques
            const publicStatut = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT statut FROM public WHERE guild = ? AND statut = ?',
                    [message.guild.id, 'on'],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(!!row);
                    }
                );
            });

            if (publicStatut) {
                const checkPublicCmd = await new Promise((resolve, reject) => {
                    db.get(
                        'SELECT command FROM cmdperm WHERE perm = ? AND command = ? AND guild = ?',
                        ['public', commandName, message.guild.id],
                        (err, row) => {
                            if (err) return reject(err);
                            resolve(!!row);
                        }
                    );
                });

                if (checkPublicCmd) return true;
            }

            // Whitelist
            const checkUserWl = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id FROM whitelist WHERE id = ?',
                    [message.author.id],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(!!row);
                    }
                );
            });

            if (checkUserWl) return true;

            // Owners enregistrés dans la base
            const checkDbOwner = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id FROM owner WHERE id = ?',
                    [message.author.id],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(!!row);
                    }
                );
            });

            if (checkDbOwner) return true;

            // Permissions par rôle
            const roles = message.member.roles.cache.map(role => role.id);

            if (roles.length === 0) return false;

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

            if (permissions.length === 0) return false;

            const commandPermissions = await new Promise((resolve, reject) => {
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

            return commandPermissions.includes(commandName);
        } catch (error) {
            console.error(
                '[RENAME] Erreur lors de la vérification des permissions :',
                error
            );

            return false;
        }
    };

    // =============================================
    // CONTRÔLE DES PERMISSIONS
    // =============================================

    if (!(await checkPerm(message, exports.help.name))) {
        const noacces = new EmbedBuilder()
            .setDescription(
                "Vous n'avez pas la permission d'utiliser cette commande."
            )
            .setColor(config.color || 0x2b2d31)
            .setFooter({
                text: message.guild.name,
                iconURL: message.guild.iconURL()
            });

        const reply = await message.reply({
            embeds: [noacces],
            allowedMentions: { repliedUser: true }
        });

        setTimeout(() => {
            reply.delete().catch(() => {});
        }, 2000);

        return;
    }

    // =============================================
    // VÉRIFICATION DU NOM
    // =============================================

    const nouv = args.join(' ').trim();

    if (!nouv) {
        return message.reply({
            content: '❌ Utilisation : `rename <nouveau nom>`',
            allowedMentions: { repliedUser: false }
        });
    }

    // Discord limite le nom d'un salon à 100 caractères.
    if (nouv.length > 100) {
        return message.reply({
            content: '❌ Le nom du salon ne peut pas dépasser 100 caractères.',
            allowedMentions: { repliedUser: false }
        });
    }

    // Évite les caractères problématiques dans les noms de salons.
    const nomSalon = nouv
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    if (!nomSalon) {
        return message.reply({
            content: '❌ Ce nom ne contient aucun caractère valide pour un salon.',
            allowedMentions: { repliedUser: false }
        });
    }

    // =============================================
    // VÉRIFICATION DU TICKET DANS LA BASE
    // =============================================

    const getTicket = (sql, params) =>
        new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });

    let ticket = null;

    try {
        // Nouveau système : table tickets
        ticket = await getTicket(
            'SELECT * FROM tickets WHERE channel_id = ?',
            [message.channel.id]
        ).catch(async error => {
            // Certaines bases utilisent channelId au lieu de channel_id.
            if (/no such column/i.test(error.message)) {
                return getTicket(
                    'SELECT * FROM tickets WHERE channelId = ?',
                    [message.channel.id]
                );
            }

            throw error;
        });

        // Ancien système : table ticketchannel
        if (!ticket) {
            ticket = await getTicket(
                'SELECT * FROM ticketchannel WHERE channelId = ?',
                [message.channel.id]
            );
        }
    } catch (error) {
        console.error('[RENAME] Erreur SQLite :', error);

        return message.reply({
            content:
                '❌ Impossible de vérifier ce ticket dans la base de données. Vérifie le nom des tables et des colonnes.',
            allowedMentions: { repliedUser: false }
        });
    }

    if (!ticket) {
        return message.reply({
            content: '❌ Ce salon n’est pas enregistré comme un ticket.',
            allowedMentions: { repliedUser: false }
        });
    }

    // =============================================
    // PERMISSIONS DISCORD
    // =============================================

    if (
        !message.channel
            .permissionsFor(message.guild.members.me)
            ?.has(PermissionFlagsBits.ManageChannels)
    ) {
        return message.reply({
            content: "❌ Je n'ai pas la permission de renommer ce salon.",
            allowedMentions: { repliedUser: false }
        });
    }

    // =============================================
    // RENOMMAGE
    // =============================================

    const ancienNom = message.channel.name;

    try {
        await message.channel.setName(
            nomSalon,
            `Ticket renommé par ${message.author.tag}`
        );
    } catch (error) {
        console.error('[RENAME] Erreur lors du renommage :', error);

        return message.reply({
            content:
                '❌ Impossible de renommer le salon. Vérifie mes permissions et réessaie plus tard.',
            allowedMentions: { repliedUser: false }
        });
    }

    // =============================================
    // EMBED DE CONFIRMATION
    // =============================================

    const embed = new EmbedBuilder()
        .setDescription(
            `✅ Le ticket a été renommé de **${ancienNom}** en **${message.channel.name}**.`
        )
        .setColor(config.color || 0x2b2d31)
        .setFooter({
            text: message.guild.name,
            iconURL: message.guild.iconURL()
        });

    await message.reply({
        embeds: [embed],
        allowedMentions: { repliedUser: false }
    });

    // =============================================
    // LOGS
    // =============================================

    const logs = new EmbedBuilder()
        .setColor(config.color || 0x2b2d31)
        .setDescription(
            `🔄 <@${message.author.id}> a renommé le salon **${ancienNom}** en **${message.channel.name}**.`
        )
        .setTimestamp()
        .setFooter({
            text: message.guild.name,
            iconURL: message.guild.iconURL()
        });

    try {
        await sendLog(message.guild, logs, 'ticketlog');
    } catch (error) {
        console.error('[RENAME] Erreur lors de l’envoi du log :', error);
    }
};

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require("discord.js");

const db = require("../../Events/loadDatabase");

exports.help = {
    name: "rest-bot",
    aliases: [],
    description: "Réinitialiser les données du bot avec deux confirmations."
};

// Promesse SQLite : récupérer une seule ligne
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) return reject(error);
            resolve(row);
        });
    });
}

// Promesse SQLite : récupérer plusieurs lignes
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) return reject(error);
            resolve(rows || []);
        });
    });
}

// Promesse SQLite : exécuter une requête
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) return reject(error);
            resolve(this);
        });
    });
}

// Réinitialisation de la base de données
async function resetDatabase(ownerId) {
    await dbRun("PRAGMA foreign_keys = OFF");

    let transactionStarted = false;

    try {
        // Vérifier que la table owner existe
        const ownerTable = await dbGet(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name = 'owner'
        `);

        if (!ownerTable) {
            throw new Error(
                "La table owner est introuvable dans la base de données."
            );
        }

        // Récupérer les propriétaires avant la remise à zéro
        const owners = await dbAll("SELECT id FROM owner");

        // S'assurer que l'auteur de la commande reste propriétaire
        const ownerIds = new Set(
            owners
                .map(owner => String(owner.id))
                .filter(Boolean)
        );

        ownerIds.add(String(ownerId));

        // Récupérer les tables de données
        const tables = await dbAll(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        `);

        // Démarrer une transaction
        await dbRun("BEGIN IMMEDIATE");
        transactionStarted = true;

        // Vider toutes les tables sans supprimer leur structure
        for (const table of tables) {
            const escapedName = table.name.replace(/"/g, '""');

            await dbRun(`DELETE FROM "${escapedName}"`);
        }

        // Réinitialiser les compteurs d'identifiants automatiques
        const sequenceTable = await dbGet(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name = 'sqlite_sequence'
        `);

        if (sequenceTable) {
            await dbRun("DELETE FROM sqlite_sequence");
        }

        // Restaurer les propriétaires pour conserver l'accès
        for (const id of ownerIds) {
            await dbRun(
                "INSERT INTO owner (id) VALUES (?)",
                [id]
            );
        }

        // Valider les changements
        await dbRun("COMMIT");
        transactionStarted = false;

        return tables.length;
    } catch (error) {
        if (transactionStarted) {
            await dbRun("ROLLBACK").catch(() => {});
        }

        throw error;
    } finally {
        await dbRun("PRAGMA foreign_keys = ON").catch(() => {});
    }
}

exports.run = async (bot, message) => {
    if (!message.guild) return;

    // Vérifier que l'auteur est propriétaire du bot
    const owner = await dbGet(
        "SELECT id FROM owner WHERE id = ?",
        [message.author.id]
    ).catch(() => null);

    if (!owner) {
        return message.reply(
            "❌ Seul un propriétaire enregistré du bot peut utiliser cette commande."
        );
    }

    // Première confirmation
    const confirmation1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("resetbot_confirm1")
            .setLabel("Confirmer (1/2)")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("resetbot_cancel")
            .setLabel("Annuler")
            .setStyle(ButtonStyle.Secondary)
    );

    // Deuxième confirmation
    const confirmation2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("resetbot_confirm2")
            .setLabel("CONFIRMER LA REMISE À ZÉRO")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("resetbot_cancel")
            .setLabel("Annuler")
            .setStyle(ButtonStyle.Secondary)
    );

    const prompt = await message.reply({
        content:
            "⚠️ **REMISE À ZÉRO DU BOT**\n\n" +
            "Cette opération va supprimer les données enregistrées " +
            "dans les tables SQLite du bot : réglages, modèles, " +
            "historiques, listes et autres données.\n\n" +
            "✅ Le code, les fichiers, la configuration et les " +
            "dépendances seront conservés.\n" +
            "✅ Les propriétaires enregistrés seront conservés.\n" +
            "🛑 Après la remise à zéro, le bot s'arrêtera.\n\n" +
            "**Première confirmation :** veux-tu continuer ?",
        components: [confirmation1]
    });

    const collector = prompt.createMessageComponentCollector({
        time: 60000
    });

    let stage = 1;
    let completed = false;

    collector.on("collect", async interaction => {
        // Seul l'auteur de la commande peut confirmer
        if (interaction.user.id !== message.author.id) {
            return interaction.reply({
                content:
                    "❌ Seul l'auteur de la commande peut confirmer.",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }

        // Annulation
        if (interaction.customId === "resetbot_cancel") {
            completed = true;

            await interaction.update({
                content:
                    "✅ Remise à zéro annulée. " +
                    "Aucune donnée n'a été supprimée.",
                components: []
            }).catch(() => {});

            return collector.stop("cancelled");
        }

        // Première confirmation : afficher la deuxième
        if (
            interaction.customId === "resetbot_confirm1" &&
            stage === 1
        ) {
            stage = 2;

            await interaction.update({
                content:
                    "⚠️ **DEUXIÈME CONFIRMATION**\n\n" +
                    "Tu es sur le point d'effacer les données " +
                    "enregistrées du bot.\n\n" +
                    "Les propriétaires seront conservés, mais les " +
                    "réglages, historiques et autres données seront supprimés.\n\n" +
                    "Après l'opération, le processus du bot s'arrêtera.\n\n" +
                    "Clique sur **CONFIRMER LA REMISE À ZÉRO** " +
                    "pour continuer.",
                components: [confirmation2]
            }).catch(() => {});

            return;
        }

        // Deuxième confirmation : exécuter la remise à zéro
        if (
            interaction.customId === "resetbot_confirm2" &&
            stage === 2
        ) {
            completed = true;
            collector.stop("reset");

            await interaction.update({
                content: "⏳ Réinitialisation en cours…",
                components: []
            }).catch(() => {});

            try {
                const count = await resetDatabase(message.author.id);

                await prompt.edit({
                    content:
                        "✅ **REMISE À ZÉRO TERMINÉE**\n\n" +
                        `Tables de données vidées : **${count}**.\n` +
                        "✅ Les propriétaires ont été conservés.\n" +
                        "🛑 Le bot va maintenant s'arrêter.\n\n" +
                        "Tu pourras le redémarrer depuis Pterodactyl.",
                    components: []
                });

                console.log(
                    "[REST-BOT] Base réinitialisée. Arrêt du processus."
                );

                // Arrêter le bot après l'envoi du message
                setTimeout(() => {
                    process.exit(0);
                }, 2000);

            } catch (error) {
                console.error("[REST-BOT]", error);

                await prompt.edit({
                    content:
                        "❌ **Échec de la remise à zéro.**\n\n" +
                        "Consulte les logs Pterodactyl pour connaître " +
                        "la cause. Le bot n'a pas été arrêté par cette commande.",
                    components: []
                }).catch(() => {});
            }
        }
    });

    // Expiration des confirmations
    collector.on("end", async () => {
        if (!completed) {
            await prompt.edit({
                content:
                    "⌛ Confirmation expirée. " +
                    "Aucune remise à zéro n'a été effectuée.",
                components: []
            }).catch(() => {});
        }
    });
};

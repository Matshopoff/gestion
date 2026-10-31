
const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField
} = require("discord.js");

const db = require("../../Events/loadDatabase");

/* =========================================================
   INFORMATIONS DE LA COMMANDE
========================================================= */

exports.help = {
    name: "embed",
    aliases: ["embeds"],
    description: "Créer, modifier, enregistrer et envoyer des embeds."
};

/* =========================================================
   CONFIGURATION
========================================================= */

const ROLE_BUTTON_PREFIX = "embed_role_toggle_";
const MAX_EMBEDS = 10;
const MAX_ROLE_BUTTONS = 25;
const EDITOR_TIMEOUT = 15 * 60 * 1000;

let tableReady = null;

/* =========================================================
   SQLITE
========================================================= */

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) return reject(error);
            resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) return reject(error);
            resolve(row);
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

function ensureTable() {
    if (!tableReady) {
        tableReady = dbRun(`
            CREATE TABLE IF NOT EXISTS embed_templates (
                guild_id TEXT NOT NULL,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                created_by TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, name)
            )
        `).catch(error => {
            tableReady = null;
            throw error;
        });
    }

    return tableReady;
}

/* =========================================================
   OUTILS
========================================================= */

function safeName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 50);
}

function parseColor(value) {
    const color = String(value || "").trim();

    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
        return color;
    }

    if (/^[0-9a-fA-F]{6}$/.test(color)) {
        return `#${color}`;
    }

    return null;
}

function validUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

function createDefaultEmbed() {
    return {
        title: "",
        description: "",
        color: "#5865F2",
        url: "",
        author: "",
        footer: "",
        thumbnail: "",
        image: "",
        timestamp: false,
        fields: []
    };
}

function isEmbedEmpty(data) {
    if (!data) return true;

    return !(
        data.title?.trim() ||
        data.description?.trim() ||
        data.author?.trim() ||
        data.footer?.trim() ||
        data.image?.trim() ||
        data.thumbnail?.trim() ||
        data.url?.trim() ||
        (
            Array.isArray(data.fields) &&
            data.fields.some(field =>
                field.name?.trim() && field.value?.trim()
            )
        )
    );
}

function toEmbed(data) {
    const embed = new EmbedBuilder();

    if (data.title?.trim()) {
        embed.setTitle(data.title.slice(0, 256));
    }

    if (data.description?.trim()) {
        embed.setDescription(data.description.slice(0, 4096));
    }

    const color = parseColor(data.color);

    if (color) {
        embed.setColor(color);
    }

    if (data.url && validUrl(data.url)) {
        embed.setURL(data.url);
    }

    if (data.author?.trim()) {
        embed.setAuthor({
            name: data.author.slice(0, 256)
        });
    }

    if (data.footer?.trim()) {
        embed.setFooter({
            text: data.footer.slice(0, 2048)
        });
    }

    if (data.thumbnail && validUrl(data.thumbnail)) {
        embed.setThumbnail(data.thumbnail);
    }

    if (data.image && validUrl(data.image)) {
        embed.setImage(data.image);
    }

    if (data.timestamp) {
        embed.setTimestamp();
    }

    if (Array.isArray(data.fields)) {
        for (const field of data.fields.slice(0, 25)) {
            if (!field.name?.trim() || !field.value?.trim()) {
                continue;
            }

            embed.addFields({
                name: field.name.slice(0, 256),
                value: field.value.slice(0, 1024),
                inline: Boolean(field.inline)
            });
        }
    }

    return embed;
}

function getValidEmbeds(draft) {
    return draft.embeds
        .filter(data => !isEmbedEmpty(data))
        .map(toEmbed);
}

/* =========================================================
   EMOJIS DES BOUTONS
========================================================= */

function applyButtonEmoji(button, emojiInput) {
    if (!emojiInput) return;

    const value = String(emojiInput).trim();

    if (!value) return;

    // Emoji personnalisé : <:nom:id> ou <a:nom:id>
    const customEmoji = value.match(
        /^<(a?):([a-zA-Z0-9_]+):(\d+)>$/
    );

    if (customEmoji) {
        button.setEmoji({
            animated: customEmoji[1] === "a",
            name: customEmoji[2],
            id: customEmoji[3]
        });

        return;
    }

    // Format enregistré : nom:id
    const savedEmoji = value.match(
        /^([a-zA-Z0-9_]+):(\d+)$/
    );

    if (savedEmoji) {
        button.setEmoji({
            name: savedEmoji[1],
            id: savedEmoji[2]
        });

        return;
    }

    // Emoji Unicode classique
    button.setEmoji(value);
}

/* =========================================================
   BOUTONS DE RÔLE
========================================================= */

function makeRoleComponents(roleButtons = []) {
    const rows = [];
    const buttons = roleButtons.slice(0, MAX_ROLE_BUTTONS);

    for (let i = 0; i < buttons.length; i += 5) {
        const row = new ActionRowBuilder();

        for (const item of buttons.slice(i, i + 5)) {
            if (!item.roleId) continue;

            const button = new ButtonBuilder()
                .setCustomId(`${ROLE_BUTTON_PREFIX}${item.roleId}`)
                .setLabel(
                    String(item.label || "Obtenir le rôle").slice(0, 80)
                )
                .setStyle(
                    item.style === "secondary"
                        ? ButtonStyle.Secondary
                        : item.style === "success"
                            ? ButtonStyle.Success
                            : item.style === "danger"
                                ? ButtonStyle.Danger
                                : ButtonStyle.Primary
                );

            if (item.emoji) {
                try {
                    applyButtonEmoji(button, item.emoji);
                } catch (error) {
                    console.warn(
                        "[EMBED] Emoji de bouton invalide :",
                        item.emoji
                    );
                }
            }

            row.addComponents(button);
        }

        if (row.components.length) {
            rows.push(row);
        }
    }

    return rows;
}

/* =========================================================
   MENU DU CRÉATEUR
========================================================= */

function buildMenu() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId("embed_builder_menu")
        .setPlaceholder("Choisis une action")
        .addOptions(
            { label: "Modifier le titre", value: "title", emoji: "📝" },
            { label: "Modifier la description", value: "description", emoji: "📄" },
            { label: "Modifier la couleur", value: "color", emoji: "🎨" },
            { label: "Modifier l'auteur", value: "author", emoji: "👤" },
            { label: "Modifier le footer", value: "footer", emoji: "🔻" },
            { label: "Ajouter un champ", value: "field", emoji: "➕" },
            { label: "Modifier l'image", value: "image", emoji: "🖼️" },
            { label: "Modifier la miniature", value: "thumbnail", emoji: "🌄" },
            { label: "Modifier l'URL", value: "url", emoji: "🔗" },
            { label: "Activer/désactiver la date", value: "timestamp", emoji: "🕒" },
            { label: "Ajouter un bouton de rôle", value: "rolebutton", emoji: "🎭" },
            { label: "Ajouter un embed", value: "addembed", emoji: "📚" },
            { label: "Changer d'embed", value: "switch", emoji: "🔄" },
            { label: "Enregistrer le modèle", value: "save", emoji: "💾" },
            { label: "Envoyer les embeds", value: "send", emoji: "📨" }
        );

    return new ActionRowBuilder().addComponents(menu);
}

/* =========================================================
   MESSAGES
========================================================= */

async function safeDelete(message) {
    if (!message) return;

    try {
        await message.delete();
    } catch (error) {
        if (error.code !== 10008 && error.code !== 10003) {
            console.error("[EMBED DELETE]", error);
        }
    }
}

async function ask(message, question, timeout = 120000) {
    await message.channel.send(question);

    const collected = await message.channel.awaitMessages({
        filter: m => m.author.id === message.author.id,
        max: 1,
        time: timeout
    }).catch(() => null);

    if (!collected?.first()) {
        return null;
    }

    const response = collected.first();
    const answer = response.content.trim();

    await safeDelete(response);

    return answer;
}

/* =========================================================
   SAUVEGARDE DES MODÈLES
========================================================= */

async function saveTemplate(guildId, name, data, userId) {
    await ensureTable();

    await dbRun(
        `INSERT INTO embed_templates
            (guild_id, name, data, created_by, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(guild_id, name)
         DO UPDATE SET
            data = excluded.data,
            created_by = excluded.created_by,
            updated_at = CURRENT_TIMESTAMP`,
        [guildId, name, JSON.stringify(data), userId]
    );
}

async function getTemplate(guildId, name) {
    await ensureTable();

    const row = await dbGet(
        `SELECT data
         FROM embed_templates
         WHERE guild_id = ? AND name = ?`,
        [guildId, name]
    );

    if (!row) return null;

    try {
        return JSON.parse(row.data);
    } catch {
        return null;
    }
}

async function sendTemplate(channel, data) {
    const embedsData = (data.embeds || [])
        .filter(embed => !isEmbedEmpty(embed))
        .slice(0, MAX_EMBEDS);

    if (!embedsData.length) {
        throw new Error("Ce modèle ne contient aucun embed valide.");
    }

    const components = makeRoleComponents(data.roleButtons || []);

    await channel.send({
        embeds: embedsData.map(toEmbed).reverse(),
        components
    });
}

/* =========================================================
   ÉDITEUR INTERACTIF
========================================================= */

async function openEditor(bot, message, initialData = null) {
    const draft = initialData
        ? JSON.parse(JSON.stringify(initialData))
        : {
            embeds: [createDefaultEmbed()],
            roleButtons: []
        };

    if (!Array.isArray(draft.embeds) || draft.embeds.length === 0) {
        draft.embeds = [createDefaultEmbed()];
    }

    draft.embeds = draft.embeds.slice(0, MAX_EMBEDS);

    if (!Array.isArray(draft.roleButtons)) {
        draft.roleButtons = [];
    }

    draft.roleButtons = draft.roleButtons.slice(0, MAX_ROLE_BUTTONS);

    let activeIndex = 0;

    const previewContent = () =>
        `**Créateur d'embeds**\n` +
        `Embed actif : ${activeIndex + 1}/${draft.embeds.length}\n` +
        `Boutons de rôle : ${draft.roleButtons.length}\n` +
        "Les embeds vides ne sont pas affichés dans l'aperçu.";

    const preview = await message.channel.send({
        content: previewContent(),
        embeds: getValidEmbeds(draft),
        components: [buildMenu()]
    });

    const collector = preview.createMessageComponentCollector({
        time: EDITOR_TIMEOUT,
        filter: interaction =>
            interaction.user.id === message.author.id
    });

    collector.on("collect", async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (interaction.customId !== "embed_builder_menu") return;

        const action = interaction.values[0];

        await interaction.deferUpdate().catch(() => {});

        const current = draft.embeds[activeIndex];

        try {
            // ENVOYER LES EMBEDS
            if (action === "send") {
                const embeds = getValidEmbeds(draft).reverse();

                if (!embeds.length) {
                    await message.channel.send(
                        "❌ Ajoute au moins un élément avant l'envoi."
                    );
                    return;
                }

                await message.channel.send({
                    embeds,
                    components: makeRoleComponents(draft.roleButtons)
                });

                await message.channel.send("✅ Embeds envoyés avec succès.");
                collector.stop("sent");
                return;
            }

            // ENREGISTRER UN MODÈLE
            if (action === "save") {
                const input = await ask(
                    message,
                    "💾 Donne un nom à ce modèle, par exemple `bienvenue`."
                );

                if (!input) {
                    await message.channel.send("Enregistrement annulé.");
                    return;
                }

                const name = safeName(input);

                if (!name) {
                    await message.channel.send("❌ Nom de modèle invalide.");
                    return;
                }

                await saveTemplate(
                    message.guild.id,
                    name,
                    draft,
                    message.author.id
                );

                await message.channel.send(
                    `✅ Modèle **${name}** enregistré dans SQLite.`
                );
                return;
            }

            // AJOUTER UN EMBED
            if (action === "addembed") {
                if (draft.embeds.length >= MAX_EMBEDS) {
                    await message.channel.send(
                        "❌ Tu as atteint la limite de 10 embeds."
                    );
                    return;
                }

                draft.embeds.push(createDefaultEmbed());
                activeIndex = draft.embeds.length - 1;
            }

            // CHANGER D'EMBED
            else if (action === "switch") {
                const input = await ask(
                    message,
                    `Entre le numéro de l'embed à modifier (1 à ${draft.embeds.length}).`
                );

                const number = Number(input);

                if (
                    !Number.isInteger(number) ||
                    number < 1 ||
                    number > draft.embeds.length
                ) {
                    await message.channel.send("❌ Numéro invalide.");
                    return;
                }

                activeIndex = number - 1;
            }

            // AJOUTER UN BOUTON DE RÔLE
            else if (action === "rolebutton") {
                if (draft.roleButtons.length >= MAX_ROLE_BUTTONS) {
                    await message.channel.send(
                        "❌ Limite de 25 boutons atteinte."
                    );
                    return;
                }

                const roleInput = await ask(
                    message,
                    "🎭 Envoie l'ID du rôle à attribuer ou retirer."
                );

                if (!roleInput || !/^\d{17,20}$/.test(roleInput)) {
                    await message.channel.send("❌ ID de rôle invalide.");
                    return;
                }

                const role = await message.guild.roles
                    .fetch(roleInput)
                    .catch(() => null);

                if (!role) {
                    await message.channel.send(
                        "❌ Ce rôle n'existe pas sur ce serveur."
                    );
                    return;
                }

                const label = await ask(
                    message,
                    "Envoie le texte du bouton, par exemple `Obtenir le rôle`."
                );

                if (!label) {
                    await message.channel.send("Création du bouton annulée.");
                    return;
                }

                const emojiInput = await ask(
                    message,
                    "Envoie un emoji (🔥), un emoji personnalisé (<:nom:id>) ou écris `non`."
                );

                const emoji = emojiInput &&
                    emojiInput.toLowerCase() !== "non"
                    ? emojiInput
                    : null;

                const styleInput = await ask(
                    message,
                    "Style : `primary`, `success`, `secondary` ou `danger`."
                );

                const normalizedStyle = (styleInput || "").toLowerCase();

                const style = [
                    "primary",
                    "success",
                    "secondary",
                    "danger"
                ].includes(normalizedStyle)
                    ? normalizedStyle
                    : "primary";

                draft.roleButtons.push({
                    roleId: role.id,
                    label: label.slice(0, 80),
                    emoji,
                    style
                });

                await message.channel.send(
                    `✅ Bouton configuré pour ${role}.`
                );
            }

            // DATE
            else if (action === "timestamp") {
                current.timestamp = !current.timestamp;
            }

            // AJOUTER UN CHAMP
            else if (action === "field") {
                if (current.fields.length >= 25) {
                    await message.channel.send(
                        "❌ Maximum de 25 champs par embed."
                    );
                    return;
                }

                const name = await ask(message, "Nom du champ :");
                if (!name) return;

                const value = await ask(message, "Valeur du champ :");
                if (!value) return;

                const inlineInput = await ask(
                    message,
                    "Sur la même ligne ? Réponds `oui` ou `non`."
                );

                current.fields.push({
                    name: name.slice(0, 256),
                    value: value.slice(0, 1024),
                    inline: ["oui", "o", "yes", "y"].includes(
                        (inlineInput || "").toLowerCase()
                    )
                });
            }

            // MODIFIER LES AUTRES PROPRIÉTÉS
            else {
                const prompts = {
                    title: "📝 Envoie le titre. Écris `vider` pour le supprimer.",
                    description: "📄 Envoie la description. Écris `vider` pour la supprimer.",
                    color: "🎨 Envoie une couleur hexadécimale, par exemple `#17C8E0`.",
                    author: "👤 Envoie le nom de l'auteur. Écris `vider` pour le supprimer.",
                    footer: "🔻 Envoie le footer. Écris `vider` pour le supprimer.",
                    image: "🖼️ Envoie l'URL de l'image. Écris `vider` pour la supprimer.",
                    thumbnail: "🌄 Envoie l'URL de la miniature. Écris `vider` pour la supprimer.",
                    url: "🔗 Envoie l'URL du titre. Écris `vider` pour la supprimer."
                };

                const input = await ask(message, prompts[action]);

                if (input === null) return;

                const value = input.toLowerCase() === "vider" ? "" : input;

                if (action === "color") {
                    const color = parseColor(input);

                    if (!color) {
                        await message.channel.send(
                            "❌ Couleur invalide. Exemple : `#17C8E0`."
                        );
                        return;
                    }

                    current.color = color;
                } else if (
                    ["image", "thumbnail", "url"].includes(action)
                ) {
                    if (value && !validUrl(value)) {
                        await message.channel.send(
                            "❌ URL invalide. Utilise une URL HTTP ou HTTPS."
                        );
                        return;
                    }

                    current[action] = value;
                } else if (action === "title") {
                    current.title = value.slice(0, 256);
                } else if (action === "description") {
                    current.description = value.slice(0, 4096);
                } else if (action === "author") {
                    current.author = value.slice(0, 256);
                } else if (action === "footer") {
                    current.footer = value.slice(0, 2048);
                }
            }

            // RAFRAÎCHIR L'APERÇU
            await preview.edit({
                content: previewContent(),
                embeds: getValidEmbeds(draft),
                components: [buildMenu()]
            });
        } catch (error) {
            console.error("[EMBED BUILDER]", error);

            await message.channel.send(
                "❌ Erreur pendant la modification. Vérifie la console Pterodactyl."
            ).catch(() => {});
        }
    });

    collector.on("end", async () => {
        await preview.edit({ components: [] }).catch(() => {});
    });
}

/* =========================================================
   COMMANDE PRINCIPALE
========================================================= */

exports.run = async (bot, message, args) => {
    if (!message.guild) return;

    try {
        await ensureTable();

        // PERMISSIONS
        const isOwner = await dbGet(
            "SELECT id FROM owner WHERE id = ?",
            [message.author.id]
        ).catch(() => null);

        const isWhitelisted = await dbGet(
            "SELECT id FROM whitelist WHERE id = ?",
            [message.author.id]
        ).catch(() => null);

        const hasManageGuild = message.member.permissions.has(
            PermissionsBitField.Flags.ManageGuild
        );

        if (!isOwner && !isWhitelisted && !hasManageGuild) {
            return message.reply(
                "❌ Tu n'as pas la permission d'utiliser cette commande."
            );
        }

        const subcommand = (args[0] || "").toLowerCase();
        const name = safeName(args.slice(1).join(" "));

        // LISTE DES MODÈLES
        if (["list", "liste"].includes(subcommand)) {
            const rows = await dbAll(
                `SELECT name, updated_at
                 FROM embed_templates
                 WHERE guild_id = ?
                 ORDER BY name`,
                [message.guild.id]
            );

            if (!rows.length) {
                return message.reply(
                    "📂 Aucun modèle enregistré. Utilise `+embed` pour en créer un."
                );
            }

            const embed = new EmbedBuilder()
                .setColor("#17C8E0")
                .setTitle("📚 Modèles enregistrés")
                .setDescription(
                    rows.map(row => `• **${row.name}**`)
                        .join("\n")
                        .slice(0, 4000)
                )
                .setFooter({ text: `${rows.length} modèle(s)` });

            return message.channel.send({ embeds: [embed] });
        }

        // CHARGER UN MODÈLE
        if (["load", "charger"].includes(subcommand)) {
            if (!name) {
                return message.reply(
                    "Utilisation : `+embed load nom-du-modele`"
                );
            }

            const data = await getTemplate(message.guild.id, name);

            if (!data) {
                return message.reply(
                    "❌ Modèle introuvable. Utilise `+embed list`."
                );
            }

            await sendTemplate(message.channel, data);

            return message.reply(`✅ Modèle **${name}** envoyé.`);
        }

        // MODIFIER UN MODÈLE
        if (["edit", "modifier"].includes(subcommand)) {
            if (!name) {
                return message.reply(
                    "Utilisation : `+embed edit nom-du-modele`"
                );
            }

            const data = await getTemplate(message.guild.id, name);

            if (!data) {
                return message.reply(
                    "❌ Modèle introuvable. Utilise `+embed list`."
                );
            }

            return openEditor(bot, message, data);
        }

        // SUPPRIMER UN MODÈLE
        if (["delete", "supprimer"].includes(subcommand)) {
            if (!name) {
                return message.reply(
                    "Utilisation : `+embed delete nom-du-modele`"
                );
            }

            const result = await dbRun(
                `DELETE FROM embed_templates
                 WHERE guild_id = ? AND name = ?`,
                [message.guild.id, name]
            );

            if (!result.changes) {
                return message.reply("❌ Modèle introuvable.");
            }

            return message.reply(`🗑️ Modèle **${name}** supprimé.`);
        }

        // OUVRIR LE CRÉATEUR
        return openEditor(bot, message);
    } catch (error) {
        console.error("[EMBED COMMAND]", error);

        return message.reply(
            "❌ Impossible d'exécuter la commande embed. Consulte les logs Pterodactyl."
        ).catch(() => {});
    }
};
